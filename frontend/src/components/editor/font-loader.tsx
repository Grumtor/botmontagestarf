"use client";

import { useEditorStore } from "@/store/editor";
import { fontFamily } from "@/lib/editor-types";

/**
 * Emits @font-face declarations for every font known to the editor store
 * (built-in + uploaded). Mount once at the editor root so the styles are
 * available everywhere — canvas, inspector preview, font select dropdown.
 */
export function FontLoader() {
  const fonts = useEditorStore((s) => s.fonts);

  if (fonts.length === 0) return null;

  const css = fonts
    .map(
      (f) => `
      @font-face {
        font-family: '${fontFamily(f.id)}';
        src: url('/api/fonts/${f.id}');
        font-display: swap;
      }`,
    )
    .join("\n");

  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}
