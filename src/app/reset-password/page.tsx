import type { Metadata } from "next";
import { ResetPassword } from "@/components/ResetPassword";

export const metadata: Metadata = { title: "Reset password — NijiDocs", robots: { index: false, follow: false } };

export default function ResetPasswordPage() {
  return <ResetPassword />;
}
