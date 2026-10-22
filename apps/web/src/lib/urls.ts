export const fileUrl = (tenantId: string, fileId: string | null | undefined) =>
  fileId ? `/api/files/${tenantId}/${fileId}` : null;
