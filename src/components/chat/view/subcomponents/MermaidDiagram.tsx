import { useEffect, useRef, useState } from 'react';

let mermaidIdCounter = 0;

export default function MermaidDiagram({ code, isDarkMode }: { code: string; isDarkMode: boolean }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const idRef = useRef(`mermaid-${mermaidIdCounter++}`);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setSvg(null);
    void (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({ startOnLoad: false, theme: isDarkMode ? 'dark' : 'default' });
        const { svg: rendered } = await mermaid.render(idRef.current, code);
        if (!cancelled) {
          setSvg(rendered);
        }
      } catch (error) {
        console.error('Mermaid render failed:', error);
        if (!cancelled) {
          setFailed(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, isDarkMode]);

  if (failed) {
    return (
      <pre className="my-2 overflow-x-auto rounded-xl bg-muted p-4 text-sm">
        <code>{code}</code>
      </pre>
    );
  }

  if (!svg) {
    return <div className="my-2 text-xs text-muted-foreground">Rendering diagram…</div>;
  }

  return <div className="my-2 flex justify-center" dangerouslySetInnerHTML={{ __html: svg }} />;
}
