import { FlowBuilder } from "../../../../components/flow-builder";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <FlowBuilder id={id} />;
}
