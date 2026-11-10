
import { Router, Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { z } from "zod";
import rateLimit from "express-rate-limit";

import User from "../models/User.js";
import Doctor from "../models/Doctor.js";
import Patient from "../models/Patient.js";


const router = Router();

// Treat search input as literal text, not as a user-supplied regular expression.
const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getPagination = (req: Request) => {
  const page = req.query.page === undefined ? 1 : Number(req.query.page);
  const limit = req.query.limit === undefined ? 10 : Number(req.query.limit);

  if (!Number.isInteger(page) || page < 1) {
    return { error: "Page must be a positive whole number" } as const;
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return { error: "Limit must be a whole number between 1 and 100" } as const;
  }

  return { page, limit } as const;
};

const getCreatedAtRange = (fromValue: unknown, toValue: unknown) => {
  const isValidInput = (value: unknown) =>
    value === undefined || (typeof value === "string" && value.length > 0);

  if (!isValidInput(fromValue) || !isValidInput(toValue)) {
    return { error: "Date filters must be valid date strings" } as const;
  }

  const from = typeof fromValue === "string" ? new Date(fromValue) : undefined;
  const to = typeof toValue === "string" ? new Date(toValue) : undefined;

  if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
    return { error: "Please provide valid from and to dates" } as const;
  }
  if (from && to && from.getTime() > to.getTime()) {
    return { error: "The from date must be earlier than or equal to the to date" } as const;
  }

  const range: Record<string, Date> = {};
  if (from) range.$gte = from;
  if (to) range.$lte = to;

  return { range } as const;
};

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET is missing from environment variables");
}

const isProduction = process.env.NODE_ENV === "production";

const cookieOptions = {
  httpOnly: true,
  secure: isProduction,
  // Vercel and Render use different sites, so production needs SameSite=None.
  // Local development remains Lax because both services run on localhost.
  sameSite: (isProduction ? "none" : "lax") as "none" | "lax",
  path: "/",
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

const clearCookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: (isProduction ? "none" : "lax") as "none" | "lax",
  path: "/",
};

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many authentication attempts. Please try again later.",
  },
});

// ---------------- AUTHENTICATION ----------------

// Verify both the signed session and that its administrator account still exists.
const protect = async (req: Request, res: Response, next: NextFunction) => {
  const token = req.cookies?.token;

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Please log in first",
    });
  }

  let decoded: jwt.JwtPayload;

  // Only JWT verification errors should be treated as an invalid session.
  try {
    decoded = jwt.verify(token, JWT_SECRET, {
      algorithms: ["HS256"],
    }) as jwt.JwtPayload;
  } catch {
    res.clearCookie("token", clearCookieOptions);
    return res.status(401).json({
      success: false,
      message: "Invalid or expired session",
    });
  }

  if (typeof decoded.userId !== "string" || !mongoose.isValidObjectId(decoded.userId)) {
    res.clearCookie("token", clearCookieOptions);
    return res.status(401).json({
      success: false,
      message: "Invalid or expired session",
    });
  }

  // Keep the database lookup outside the JWT try/catch. Database outages
  // should reach Express error handling instead of being mislabeled as 401.
  const user = await User.findById(decoded.userId).select("_id role").lean();

  if (!user || user.role !== "admin") {
    res.clearCookie("token", clearCookieOptions);
    return res.status(401).json({
      success: false,
      message: "Your administrator session is no longer valid. Please log in again.",
    });
  }

  res.locals.userId = user._id.toString();
  return next();
};

// Register the first administrator only.
// A unique role index in User prevents two simultaneous first-admin registrations.
router.post("/auth/register", authLimiter, async (req, res) => {
  const schema = z.object({
    name: z.string().trim().min(2).max(100),
    email: z.string().trim().email().max(254),
    password: z.string().min(8).max(128),
  }).strict();

  const parsed = schema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      message: "Invalid registration information",
      errors: parsed.error.flatten(),
    });
  }

  // Ensure the unique role index exists before checking registration availability.
  await User.init();

  if (await User.exists({})) {
    return res.status(403).json({
      success: false,
      message: "Administrator registration is already closed",
    });
  }

  const { name, email, password } = parsed.data;
  const hashedPassword = await bcrypt.hash(password, 12);

  try {
    const user = await User.create({
      name,
      email: email.toLowerCase(),
      password: hashedPassword,
      role: "admin",
    });

    return res.status(201).json({
      success: true,
      message: "Administrator account created. Please log in.",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (error: unknown) {
    // Concurrent registration or duplicate administrator/email.
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === 11000
    ) {
      return res.status(403).json({
        success: false,
        message: "Administrator registration is already closed or this email is already registered",
      });
    }
    throw error;
  }
});

router.post("/auth/login", authLimiter, async (req, res) => {
  const schema = z.object({
    email: z.string().trim().email().max(254),
    password: z.string().min(1).max(128),
  }).strict();

  const parsed = schema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      message: "Please provide a valid email and password",
    });
  }

  const user = await User.findOne({
    email: parsed.data.email.toLowerCase(),
  }).select("+password");

  if (!user || !(await bcrypt.compare(parsed.data.password, user.password))) {
    return res.status(401).json({
      success: false,
      message: "Incorrect email or password",
    });
  }

  if (user.role !== "admin") {
    return res.status(403).json({
      success: false,
      message: "This account is not authorized to access the administrator dashboard",
    });
  }

  const token = jwt.sign(
    { userId: user._id.toString() },
    JWT_SECRET,
    { expiresIn: "7d", algorithm: "HS256" }
  );

  res.cookie("token", token, cookieOptions);

  return res.status(200).json({
    success: true,
    message: "Login successful",
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
    },
  });
});

router.get("/auth/me", protect, async (_req, res) => {
  const user = await User.findById(res.locals.userId).select("name email role");

  if (!user || user.role !== "admin") {
    res.clearCookie("token", clearCookieOptions);
    return res.status(401).json({
      success: false,
      message: "User not found or administrator access revoked",
    });
  }

  return res.json({
    success: true,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
    },
  });
});

router.post("/auth/logout", (_req, res) => {
  res.clearCookie("token", clearCookieOptions);

  return res.json({
    success: true,
    message: "Logged out successfully",
  });
});

// All routes below this point require authentication
router.use(protect);

// ---------------- DOCTOR MANAGEMENT ----------------

router.get("/doctors", async (req, res) => {
  const pagination = getPagination(req);
  if ("error" in pagination) {
    return res.status(400).json({ success: false, message: pagination.error });
  }
  const { page, limit } = pagination;
  const search = String(req.query.search || "").trim().slice(0, 100);
  const safeSearch = escapeRegex(search);
  const filter: Record<string, unknown> = {};

  if (search) {
    filter.$or = [
      { name: { $regex: safeSearch, $options: "i" } },
      { specialization: { $regex: safeSearch, $options: "i" } },
      { hospital: { $regex: safeSearch, $options: "i" } },
      { email: { $regex: safeSearch, $options: "i" } },
      { phone: { $regex: safeSearch, $options: "i" } },
    ];
  }

  if (req.query.from !== undefined || req.query.to !== undefined) {
    const dateRange = getCreatedAtRange(req.query.from, req.query.to);
    if ("error" in dateRange) {
      return res.status(400).json({ success: false, message: dateRange.error });
    }
    filter.createdAt = dateRange.range;
  }

  const [doctors, total] = await Promise.all([
    Doctor.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Doctor.countDocuments(filter),
  ]);

  const doctorIds = doctors.map((doctor) => doctor._id);

  const patientCounts = await Patient.aggregate([
    { $match: { doctor: { $in: doctorIds } } },
    { $group: { _id: "$doctor", count: { $sum: 1 } } },
  ]);

  const countMap = new Map(
    patientCounts.map((item) => [item._id.toString(), item.count])
  );

  return res.json({
    success: true,
    data: doctors.map((doctor) => ({
      ...doctor,
      patientCount: countMap.get(doctor._id.toString()) || 0,
    })),
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    },
  });
});

router.post("/doctors", async (req, res) => {
  const schema = z.object({
    name: z.string().trim().min(2).max(100),
    specialization: z.string().trim().min(2).max(100),
    hospital: z.string().trim().min(2).max(150),
    phone: z.string().trim().min(5).max(25),
    email: z.string().trim().email().max(254),
  });

  const parsed = schema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      message: "Invalid doctor information",
      errors: parsed.error.flatten(),
    });
  }

  const doctor = await Doctor.create(parsed.data);

  return res.status(201).json({
    success: true,
    message: "Doctor added successfully",
    data: doctor,
  });
});

router.get("/doctors/:id", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ success: false, message: "Invalid doctor ID" });
  }

  const doctor = await Doctor.findById(req.params.id);

  if (!doctor) {
    return res.status(404).json({ success: false, message: "Doctor not found" });
  }

  const patients = await Patient.find({ doctor: doctor._id }).sort({
    createdAt: -1,
  });

  return res.json({
    success: true,
    data: { ...doctor.toObject(), patients },
  });
});

router.put("/doctors/:id", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ success: false, message: "Invalid doctor ID" });
  }

  const schema = z.object({
    name: z.string().trim().min(2).max(100).optional(),
    specialization: z.string().trim().min(2).max(100).optional(),
    hospital: z.string().trim().min(2).max(150).optional(),
    phone: z.string().trim().min(5).max(25).optional(),
    email: z.string().trim().email().max(254).optional(),
  });

  const parsed = schema.safeParse(req.body);

  if (!parsed.success || Object.keys(parsed.data || {}).length === 0) {
    return res.status(400).json({
      success: false,
      message: "Provide valid doctor information",
    });
  }

  const doctor = await Doctor.findByIdAndUpdate(
    req.params.id,
    parsed.data,
    { new: true, runValidators: true }
  );

  if (!doctor) {
    return res.status(404).json({ success: false, message: "Doctor not found" });
  }

  return res.json({ success: true, data: doctor });
});

router.delete("/doctors/:id", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ success: false, message: "Invalid doctor ID" });
  }

  const doctor = await Doctor.findById(req.params.id);

  if (!doctor) {
    return res.status(404).json({ success: false, message: "Doctor not found" });
  }

  // Do not delete a doctor while patients are still assigned to them.
  // Reassign or delete those patients first, then retry doctor deletion.
  const assignedPatientCount = await Patient.countDocuments({
    doctor: doctor._id,
  });

  if (assignedPatientCount > 0) {
    return res.status(409).json({
      success: false,
      message: `This doctor cannot be deleted because ${assignedPatientCount} patient(s) are still assigned. Reassign or delete those patients first.`,
      assignedPatientCount,
    });
  }

  await doctor.deleteOne();

  return res.json({
    success: true,
    message: "Doctor deleted successfully",
  });
});

// ---------------- PATIENT MANAGEMENT ----------------

router.get("/patients", async (req, res) => {
  const pagination = getPagination(req);
  if ("error" in pagination) {
    return res.status(400).json({ success: false, message: pagination.error });
  }
  const { page, limit } = pagination;
  const search = String(req.query.search || "").trim().slice(0, 100);
  const safeSearch = escapeRegex(search);
  const filter: Record<string, unknown> = {};

  if (search) {
    filter.$or = [
      { name: { $regex: safeSearch, $options: "i" } },
      { condition: { $regex: safeSearch, $options: "i" } },
      { phone: { $regex: safeSearch, $options: "i" } },
    ];
  }

  if (req.query.doctor !== undefined) {
    if (!mongoose.isValidObjectId(String(req.query.doctor))) {
      return res.status(400).json({ success: false, message: "Invalid doctor ID filter" });
    }
    filter.doctor = req.query.doctor;
  }

  if (req.query.condition !== undefined) {
    const condition = String(req.query.condition).trim().slice(0, 100);
    filter.condition = { $regex: escapeRegex(condition), $options: "i" };
  }

  if (req.query.from !== undefined || req.query.to !== undefined) {
    const dateRange = getCreatedAtRange(req.query.from, req.query.to);
    if ("error" in dateRange) {
      return res.status(400).json({ success: false, message: dateRange.error });
    }
    filter.createdAt = dateRange.range;
  }

  const [patients, total] = await Promise.all([
    Patient.find(filter)
      .populate("doctor", "name specialization hospital")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Patient.countDocuments(filter),
  ]);

  return res.json({
    success: true,
    data: patients,
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    },
  });
});

router.post("/patients", async (req, res) => {
  const schema = z.object({
    name: z.string().trim().min(2).max(100),
    age: z.coerce.number().int().min(0).max(120),
    gender: z.enum(["Male", "Female", "Other"]),
    condition: z.string().trim().min(2).max(150),
    phone: z.string().trim().min(5).max(25),
    doctor: z.string().refine(mongoose.isValidObjectId, "Invalid doctor ID"),
  });

  const parsed = schema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      message: "Invalid patient information",
      errors: parsed.error.flatten(),
    });
  }

  const doctorExists = await Doctor.exists({ _id: parsed.data.doctor });

  if (!doctorExists) {
    return res.status(404).json({
      success: false,
      message: "Selected doctor does not exist",
    });
  }

  const patient = await Patient.create(parsed.data);
  await patient.populate("doctor", "name specialization");

  return res.status(201).json({
    success: true,
    message: "Patient added successfully",
    data: patient,
  });
});

router.get("/patients/:id", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ success: false, message: "Invalid patient ID" });
  }

  const patient = await Patient.findById(req.params.id).populate(
    "doctor",
    "name specialization hospital"
  );

  if (!patient) {
    return res.status(404).json({ success: false, message: "Patient not found" });
  }

  return res.json({ success: true, data: patient });
});

router.put("/patients/:id", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ success: false, message: "Invalid patient ID" });
  }

  const schema = z.object({
    name: z.string().trim().min(2).max(100).optional(),
    age: z.coerce.number().int().min(0).max(120).optional(),
    gender: z.enum(["Male", "Female", "Other"]).optional(),
    condition: z.string().trim().min(2).max(150).optional(),
    phone: z.string().trim().min(5).max(25).optional(),
    doctor: z.string().refine(mongoose.isValidObjectId).optional(),
  });

  const parsed = schema.safeParse(req.body);

  if (!parsed.success || Object.keys(parsed.data || {}).length === 0) {
    return res.status(400).json({
      success: false,
      message: "Provide valid patient information",
    });
  }

  if (parsed.data.doctor) {
    const exists = await Doctor.exists({ _id: parsed.data.doctor });

    if (!exists) {
      return res.status(404).json({
        success: false,
        message: "Selected doctor does not exist",
      });
    }
  }

  const patient = await Patient.findByIdAndUpdate(
    req.params.id,
    parsed.data,
    { new: true, runValidators: true }
  ).populate("doctor", "name specialization");

  if (!patient) {
    return res.status(404).json({ success: false, message: "Patient not found" });
  }

  return res.json({ success: true, data: patient });
});

router.delete("/patients/:id", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ success: false, message: "Invalid patient ID" });
  }

  const patient = await Patient.findByIdAndDelete(req.params.id);

  if (!patient) {
    return res.status(404).json({ success: false, message: "Patient not found" });
  }

  return res.json({
    success: true,
    message: "Patient deleted successfully",
  });
});

// ---------------- DASHBOARD STATISTICS ----------------

router.get("/dashboard/stats", async (_req, res) => {
  const [totalDoctors, totalPatients, recentPatients, patientsByCondition, patientsByDoctor, monthlyPatients] =
    await Promise.all([
      Doctor.countDocuments(),
      Patient.countDocuments(),
      Patient.find()
        .populate("doctor", "name specialization")
        .sort({ createdAt: -1 })
        .limit(5)
        .lean(),
      Patient.aggregate([
        { $group: { _id: "$condition", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 8 },
      ]),
      Patient.aggregate([
        { $group: { _id: "$doctor", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 8 },
        {
          $lookup: {
            from: "doctors",
            localField: "_id",
            foreignField: "_id",
            as: "doctor",
          },
        },
        { $unwind: "$doctor" },
        {
          $project: {
            _id: 0,
            name: "$doctor.name",
            count: 1,
          },
        },
      ]),
      Patient.aggregate([
        {
          $group: {
            _id: {
              year: { $year: "$createdAt" },
              month: { $month: "$createdAt" },
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { "_id.year": -1, "_id.month": -1 } },
        { $limit: 12 },
        { $sort: { "_id.year": 1, "_id.month": 1 } },
      ]),
    ]);

  return res.json({
    success: true,
    data: {
      totalDoctors,
      totalPatients,
      patientsByCondition,
      patientsByDoctor,
      monthlyPatients,
      recentPatients,
    },
  });
});

export default router;
