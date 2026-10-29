/**
 * Which brand a carousel or template belongs to. Kept free of server imports
 * so the dashboard and editor resolve ownership exactly as the server does.
 */
export function brandIdOf(
  record: { brandId?: string },
  defaultBrandId: string
): string {
  return record.brandId ?? defaultBrandId;
}
