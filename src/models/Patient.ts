
import mongoose, { Schema, Document } from "mongoose";

export interface IPatient extends Document {
  name: string;
  age: number;
  gender: "Male" | "Female" | "Other";
  condition: string;
  phone: string;
  doctor: mongoose.Types.ObjectId;
}

const patientSchema = new Schema<IPatient>(
  {
    name: { type: String, required: true, trim: true },
    age: { type: Number, required: true, min: 0 },
    gender: {
      type: String,
      enum: ["Male", "Female", "Other"],
      required: true,
    },
    condition: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    doctor: {
      type: Schema.Types.ObjectId,
      ref: "Doctor",
      required: true,
    },
  },
  { timestamps: true }
);

patientSchema.index({ doctor: 1 });
patientSchema.index({ name: 1 });
patientSchema.index({ createdAt: -1 });

export default mongoose.model<IPatient>("Patient", patientSchema);