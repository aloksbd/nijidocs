import type { Metadata } from "next";
import { PrintClient } from "./PrintClient";

export const metadata: Metadata = { title: "Print document — NijiDocs", robots: { index: false, follow: false } };

export default async function PrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PrintClient id={id} />;
}
