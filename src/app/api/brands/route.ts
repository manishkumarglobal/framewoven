import { NextResponse } from "next/server";
import { listBrands, createBrand } from "@/lib/brand";
import { dataErrorResponse } from "@/lib/api-errors";
import { pickBrandUpdate } from "@/lib/api-input";

export async function GET() {
  try {
    const { brands, defaultBrandId } = await listBrands();
    return NextResponse.json({ brands, defaultBrandId });
  } catch (err) {
    const dataError = dataErrorResponse(err);
    if (dataError) return dataError;
    throw err;
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    // Only the configurable fields; the id and timestamps are server-owned.
    const fields = pickBrandUpdate(body);
    if (!fields.name?.trim()) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    const brand = await createBrand({ ...fields, name: fields.name.trim() });
    return NextResponse.json(brand, { status: 201 });
  } catch (err) {
    const dataError = dataErrorResponse(err);
    if (dataError) return dataError;
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
