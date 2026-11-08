import ReactMarkdown, { type Components } from "react-markdown";

// "#mention" is a marker link we inject ourselves so @agent can be styled without a plugin.
const MENTION_HREF = "#relay-mention";

function markMentions(body: string): string {
  // Odd indices are code spans/fences; leave those alone.
  return body
    .split(/(```[\s\S]*?```|`[^`\n]*`)/)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(/(^|\s)@agent\b/gi, (_m, pre: string) => `${pre}[@agent](${MENTION_HREF})`)))
    .join("");
}

const components: Components = {
  p: (props) => <p className="my-1.5 first:mt-0 last:mb-0" {...stripNode(props)} />,
  ul: (props) => <ul className="my-2 list-disc space-y-0.5 pl-5" {...stripNode(props)} />,
  ol: (props) => <ol className="my-2 list-decimal space-y-0.5 pl-5" {...stripNode(props)} />,
  h1: (props) => <h3 className="mt-4 mb-1.5 text-base font-semibold" {...stripNode(props)} />,
  h2: (props) => <h3 className="mt-4 mb-1.5 text-base font-semibold" {...stripNode(props)} />,
  h3: (props) => <h4 className="mt-3 mb-1 font-semibold" {...stripNode(props)} />,
  pre: (props) => <pre className="my-2 overflow-x-auto rounded-ctl border border-line bg-black/40 p-2.5 font-mono text-xs leading-relaxed" {...stripNode(props)} />,
  code: (props) => <code className="rounded-ctl bg-black/40 px-1 py-0.5 font-mono text-[0.85em]" {...stripNode(props)} />,
  blockquote: (props) => <blockquote className="my-2 border-l-2 border-line pl-3 text-muted" {...stripNode(props)} />,
  a: ({ href, children }) =>
    href === MENTION_HREF ? (
      <span className="font-semibold text-accent">{children}</span>
    ) : (
      <a href={href} target="_blank" rel="noreferrer" className="text-done underline">
        {children}
      </a>
    ),
};

function stripNode<T extends { node?: unknown }>(props: T): Omit<T, "node"> {
  const rest = { ...props };
  delete rest.node;
  return rest;
}

export function Markdown({ children, mentions = false }: { children: string; mentions?: boolean }) {
  return (
    <div className="font-ui leading-relaxed break-words">
      <ReactMarkdown components={components}>{mentions ? markMentions(children) : children}</ReactMarkdown>
    </div>
  );
}
