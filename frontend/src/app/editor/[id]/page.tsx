import { notFound } from "next/navigation";
import { EditorView } from "./editor-view";

export default async function EditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isFinite(numericId) || numericId <= 0) notFound();
  return <EditorView id={numericId} />;
}
