import { NextResponse } from "next/server";
import { getBrandById, updateBrandById } from "@/lib/brand";
import { dataErrorResponse } from "@/lib/api-errors";
import { pickBrandUpdate } from "@/lib/api-input";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const brand = await getBrandById(id);
    if (!brand) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(brand);
  } catch (err) {
    const dataError = dataErrorResponse(err);
    if (dataError) return dataError;
    throw err;
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await request.json();
    // The settings form posts the whole stored object back, id and timestamps
    // included. Only the configurable fields are carried across.
    const fields = pickBrandUpdate(body);
    // A brand without a name is left out of the design agent's prompt entirely.
    if (fields.name !== undefined) {
      if (!fields.name.trim()) {
        return NextResponse.json({ error: "Name is required" }, { status: 400 });
      }
      fields.name = fields.name.trim();
    }
    const updated = await updateBrandById(id, fields);
    if (!updated) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(updated);
  } catch (err) {
    const dataError = dataErrorResponse(err);
    if (dataError) return dataError;
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
