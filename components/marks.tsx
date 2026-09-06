// The marks this world uses instead of glyphs. Every one is drawn at the same contour weight as the
// cards themselves (2 units on a 24 unit grid), because a lotera tabla is marked with objects, not
// with typography. Each mark ships beside a word: the shape carries meaning for a colour-blind
// reader and across a room, and the word carries it for a screen reader.

type MarkProps = { className?: string; title?: string };

const CONTOUR = { stroke: "var(--ink)", strokeWidth: 2, strokeLinejoin: "round" as const };

/** A dried bean: the mark that a disclosure was actually made. */
export function Bean({ className, title }: MarkProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} role="img" aria-label={title} focusable="false">
      {title ? <title>{title}</title> : null}
      <path
        d="M16.8 4.6c3.4 2 4.5 6.9 2.4 10.9s-6.3 5.8-9.7 3.9-4.5-6.9-2.4-10.9 6.3-5.8 9.7-3.9Z"
        fill="var(--bean)"
        {...CONTOUR}
      />
      <path
        d="M10.4 8.2c-1.5 1.2-2.3 3-2.2 4.8"
        fill="none"
        stroke="#c9a878"
        strokeWidth={1.6}
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Half a bean: the customer got some of it, not all of it. */
export function BeanHalf({ className, title }: MarkProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} role="img" aria-label={title} focusable="false">
      {title ? <title>{title}</title> : null}
      <path
        d="M16.8 4.6c3.4 2 4.5 6.9 2.4 10.9s-6.3 5.8-9.7 3.9-4.5-6.9-2.4-10.9 6.3-5.8 9.7-3.9Z"
        fill="var(--paper-deep)"
        {...CONTOUR}
      />
      <path
        d="M16.8 4.6c3.4 2 4.5 6.9 2.4 10.9L7.1 8.5c1.4-2.7 4-4.4 6.6-4.6 1.1-.1 2.1.2 3.1.7Z"
        fill="var(--bean)"
        stroke="none"
      />
      <path
        d="M16.8 4.6c3.4 2 4.5 6.9 2.4 10.9s-6.3 5.8-9.7 3.9-4.5-6.9-2.4-10.9 6.3-5.8 9.7-3.9Z"
        fill="none"
        {...CONTOUR}
      />
    </svg>
  );
}

/** An empty square with a cross: called, and nobody could mark it. */
export function CrossMark({ className, title }: MarkProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} role="img" aria-label={title} focusable="false">
      {title ? <title>{title}</title> : null}
      <rect x="3.5" y="3.5" width="17" height="17" rx="2" fill="var(--paper)" {...CONTOUR} />
      <path
        d="m8 8 8 8M16 8l-8 8"
        fill="none"
        stroke="var(--carnival)"
        strokeWidth={2.6}
        strokeLinecap="round"
      />
    </svg>
  );
}

/** An empty square: this one has not been called yet. */
export function EmptySquare({ className, title }: MarkProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} role="img" aria-label={title} focusable="false">
      {title ? <title>{title}</title> : null}
      <rect
        x="3.5"
        y="3.5"
        width="17"
        height="17"
        rx="2"
        fill="var(--paper)"
        stroke="var(--ink)"
        strokeWidth={2}
        strokeDasharray="3 3"
      />
    </svg>
  );
}

/** The flag the caller raises: a prohibited claim was made out loud. */
export function FlagMark({ className, title }: MarkProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} role="img" aria-label={title} focusable="false">
      {title ? <title>{title}</title> : null}
      <path d="M6 21V3" fill="none" stroke="var(--ink)" strokeWidth={2.4} strokeLinecap="round" />
      <path d="M6 4h12l-3 4 3 4H6Z" fill="var(--carnival)" {...CONTOUR} />
    </svg>
  );
}

/** The ornament that separates one thing from the next on a printed sheet. */
export function StarOrnament({ className, title }: MarkProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} role="img" aria-label={title} focusable="false">
      {title ? <title>{title}</title> : null}
      <path
        d="m12 2.8 2.6 6.1 6.6.6-5 4.3 1.5 6.4-5.7-3.4-5.7 3.4L7.8 13.8l-5-4.3 6.6-.6Z"
        fill="var(--carnival)"
        {...CONTOUR}
      />
    </svg>
  );
}

/** The speaker cone Saakshi talks through. */
export function CallerHorn({ className, title }: MarkProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} role="img" aria-label={title} focusable="false">
      {title ? <title>{title}</title> : null}
      <path d="M3 9.5h4L13 5v14l-6-4.5H3Z" fill="var(--sun)" {...CONTOUR} />
      <path
        d="M16.5 8.6a4.8 4.8 0 0 1 0 6.8M19.4 6a8.8 8.8 0 0 1 0 12"
        fill="none"
        stroke="var(--ink)"
        strokeWidth={2}
        strokeLinecap="round"
      />
    </svg>
  );
}

/** A sealed record: the certificate's own mark. */
export function SealMark({ className, title }: MarkProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} role="img" aria-label={title} focusable="false">
      {title ? <title>{title}</title> : null}
      <path
        d="M12 2.4 14.3 4l2.8-.4 1 2.6 2.4 1.5-.8 2.7.8 2.7-2.4 1.5-1 2.6-2.8-.4L12 18.4 9.7 16.8l-2.8.4-1-2.6-2.4-1.5.8-2.7-.8-2.7L5.9 6.2l1-2.6 2.8.4Z"
        fill="var(--turquoise)"
        {...CONTOUR}
      />
      <path
        d="M12 19v3M9.6 18.4 8 22M14.4 18.4 16 22"
        fill="none"
        stroke="var(--ink)"
        strokeWidth={2}
        strokeLinecap="round"
      />
    </svg>
  );
}
