import { useEffect, useId, useState } from "react";

interface MermaidBlockProps {
  chart: string;
}

/**
 * Renders a ```mermaid fence from markdown as a diagram. mermaid is loaded on
 * first use so pages that never show a diagram do not pay for it. The model
 * writes this syntax, so it is sometimes invalid; a failed parse falls back to
 * the source as a plain code block rather than an error.
 */
export const MermaidBlock = ({ chart }: MermaidBlockProps) => {
  const id = `mermaid-${useId().replace(/:/g, "")}`;
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    setFailed(false);

    import("mermaid")
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "neutral" });
        const { svg: rendered } = await mermaid.render(id, chart);
        if (!cancelled) setSvg(rendered);
      })
      .catch(() => {
        // mermaid leaves its error element in the body on a failed render.
        document.getElementById(`d${id}`)?.remove();
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [chart, id]);

  if (failed) {
    return (
      <pre className="bg-neutral-100 rounded p-3 text-xs font-mono overflow-x-auto mb-2">
        <code>{chart}</code>
      </pre>
    );
  }

  if (!svg) {
    return <div className="text-xs text-typography-500 mb-2">Rendering chart…</div>;
  }

  return (
    <div
      className="overflow-x-auto mb-2 flex justify-center"
      // SVG produced by mermaid with securityLevel "strict".
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
};
