// Public endpoint used by the print page. It never sees the document key
// (that lives in the link's #fragment); it only decides whether the link is
// still inside its 15-minute window and hands out short-lived download URLs
// for the encrypted files.
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_REQUESTS = 5;

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}
const noStore = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

async function load(id: string) {
  const db = admin();
  const { data: share } = await db.from("print_shares").select("*").eq("id", id).maybeSingle();
  if (!share) return { db, share: null, doc: null };
  const { data: doc } = await db.from("documents").select("id, owner_id, page_count, enc_meta").eq("id", share.document_id).maybeSingle();
  return { db, share, doc };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ status: "invalid" }, { status: 404, headers: noStore });
  const { db, share, doc } = await load(id);
  if (!share || !doc) return NextResponse.json({ status: "invalid" }, { status: 404, headers: noStore });
  if (share.status === "revoked") return NextResponse.json({ status: "revoked" }, { headers: noStore });

  const expired = new Date(share.expires_at).getTime() <= Date.now();
  if (expired) {
    return NextResponse.json({ status: share.status === "requested" ? "requested" : "expired",
      canRequest: share.request_count < MAX_REQUESTS }, { headers: noStore });
  }

  const paths = Array.from({ length: doc.page_count }, (_, i) => `${doc.owner_id}/${doc.id}/${i}`);
  const { data: signed, error } = await db.storage.from("vault").createSignedUrls(paths, 120);
  if (error || !signed) return NextResponse.json({ status: "error" }, { status: 500, headers: noStore });

  // Log an "opened" event at most once every 2 minutes per link
  const last = share.last_opened_at ? new Date(share.last_opened_at).getTime() : 0;
  if (Date.now() - last > 120_000) {
    await db.from("print_shares").update({ last_opened_at: new Date().toISOString() }).eq("id", id);
    await db.from("activity").insert({ document_id: doc.id, event: "print_link_opened" });
  }

  return NextResponse.json({
    status: "active", expiresAt: share.expires_at, encMeta: doc.enc_meta,
    files: signed.map((s) => s.signedUrl),
  }, { headers: noStore });
}

// The print shop asks the owner for 15 more minutes
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ status: "invalid" }, { status: 404, headers: noStore });
  const { db, share } = await load(id);
  if (!share) return NextResponse.json({ status: "invalid" }, { status: 404, headers: noStore });
  if (share.status === "revoked") return NextResponse.json({ status: "revoked" }, { headers: noStore });
  if (share.status === "requested") return NextResponse.json({ status: "requested" }, { headers: noStore });
  if (new Date(share.expires_at).getTime() > Date.now()) return NextResponse.json({ status: "active" }, { headers: noStore });
  if (share.request_count >= MAX_REQUESTS)
    return NextResponse.json({ status: "expired", canRequest: false }, { headers: noStore });

  await db.from("print_shares").update({ status: "requested", request_count: share.request_count + 1 }).eq("id", id);
  await db.from("activity").insert({ document_id: share.document_id, event: "print_access_requested" });
  return NextResponse.json({ status: "requested" }, { headers: noStore });
}
