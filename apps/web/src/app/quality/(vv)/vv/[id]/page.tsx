import { VvDetailPage } from "@/components/quality/vv-detail-page";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <VvDetailPage id={id} />;
}
