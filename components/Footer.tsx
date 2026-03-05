export default function Footer() {
  return (
    <footer className="mt-16 pb-8 text-center text-sm text-[var(--text-secondary)]">
      Inspired by{" "}
      <a
        href="https://csauthors.net/distance"
        className="underline hover:text-[var(--board-dark)]"
        target="_blank"
        rel="noopener noreferrer"
      >
        CSauthors.net/distance
      </a>
      .{" "}
      <a
        href="https://github.com/TomManMaz/chess-distance"
        className="underline hover:text-[var(--board-dark)]"
        target="_blank"
        rel="noopener noreferrer"
      >
        Source on GitHub
      </a>
      .
      <br />
      <span className="text-xs">
        Built with{" "}
        <a href="https://nextjs.org" className="underline hover:text-[var(--board-dark)]" target="_blank" rel="noopener noreferrer">Next.js</a>,{" "}
        <a href="https://www.cockroachlabs.com" className="underline hover:text-[var(--board-dark)]" target="_blank" rel="noopener noreferrer">CockroachDB</a>,{" "}
        <a href="https://tailwindcss.com" className="underline hover:text-[var(--board-dark)]" target="_blank" rel="noopener noreferrer">Tailwind CSS</a>,{" "}
        and <a href="https://vercel.com" className="underline hover:text-[var(--board-dark)]" target="_blank" rel="noopener noreferrer">Vercel</a>.
      </span>
    </footer>
  );
}
