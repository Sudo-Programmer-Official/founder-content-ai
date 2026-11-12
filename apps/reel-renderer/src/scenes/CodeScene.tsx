import { interpolate, useCurrentFrame } from "remotion";
import type { ReelCodeScene } from "../../../../packages/shared-types/src/reel-studio";
import { Heading, SceneFrame, useEnter } from "../primitives";
import { fitFontSize, type ReelTheme } from "../theme";

const KEYWORDS = new Set([
  "async", "await", "break", "case", "class", "const", "continue", "def", "else", "export", "false", "for",
  "from", "func", "function", "if", "import", "in", "interface", "let", "new", "null", "return", "select",
  "struct", "switch", "this", "throw", "true", "try", "type", "var", "while", "with", "yield", "None", "True",
  "False", "public", "private", "static", "void", "fn", "pub", "use", "go", "package", "where", "and", "or",
]);

interface Token {
  text: string;
  kind: "plain" | "keyword" | "string" | "comment" | "number";
}

/** Deliberately tiny highlighter: enough contrast for a reel, no grammar per language. */
function tokenizeLine(line: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /(\/\/.*$|#.*$|--.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(line)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ text: line.slice(lastIndex, match.index), kind: "plain" });
    }

    if (match[1]) {
      tokens.push({ text: match[1], kind: "comment" });
    } else if (match[2]) {
      tokens.push({ text: match[2], kind: "string" });
    } else if (match[3]) {
      tokens.push({ text: match[3], kind: "number" });
    } else {
      tokens.push({ text: match[4], kind: KEYWORDS.has(match[4]) ? "keyword" : "plain" });
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < line.length) {
    tokens.push({ text: line.slice(lastIndex), kind: "plain" });
  }

  return tokens;
}

const TOKEN_COLORS: Record<Token["kind"], string> = {
  plain: "#e6e9f5",
  keyword: "#c792ea",
  string: "#a5e075",
  comment: "#6b7394",
  number: "#ffb86c",
};

export function CodeScene(props: { scene: ReelCodeScene; theme: ReelTheme; durationInFrames: number }) {
  const { scene, theme, durationInFrames } = props;
  const frame = useCurrentFrame();
  const windowEnter = useEnter(6);
  const lines = scene.code.replace(/\t/g, "  ").split("\n");
  const longestLine = Math.max(...lines.map((line) => line.length), 1);
  const fontSize = Math.max(22, Math.min(38, Math.floor(820 / (longestLine * 0.6))));
  const totalChars = scene.code.length;
  const typeEnd = Math.max(20, Math.round(durationInFrames * 0.6));
  const visibleChars = Math.floor(
    interpolate(frame, [14, typeEnd], [0, totalChars], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
  );
  let remaining = visibleChars;

  return (
    <SceneFrame durationInFrames={durationInFrames}>
      <div style={{ display: "flex", flexDirection: "column", gap: 44 }}>
        <Heading theme={theme} text={scene.heading} size={fitFontSize(scene.heading, 68, 50, 26)} />
        <div
          style={{
            borderRadius: 28,
            overflow: "hidden",
            background: theme.codeBackground,
            border: `2px solid ${theme.dark ? theme.surfaceBorder : "transparent"}`,
            boxShadow: theme.dark ? theme.glow(`${theme.accent}33`) : "0 30px 60px rgba(20, 22, 28, 0.25)",
            opacity: windowEnter,
            transform: `translateY(${interpolate(windowEnter, [0, 1], [60, 0])}px)`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "22px 28px", background: "rgba(255,255,255,0.05)" }}>
            {["#ff5f57", "#febc2e", "#28c840"].map((color) => (
              <span key={color} style={{ width: 20, height: 20, borderRadius: "50%", background: color }} />
            ))}
            <span style={{ marginLeft: 16, fontFamily: theme.monoFont, fontSize: 24, color: "#8b93b5" }}>{scene.language}</span>
          </div>
          <pre
            style={{
              margin: 0,
              padding: "28px 32px 36px",
              fontFamily: theme.monoFont,
              fontSize,
              lineHeight: 1.55,
              whiteSpace: "pre",
            }}
          >
            {lines.map((line, lineIndex) => {
              const visibleInLine = Math.max(0, Math.min(line.length, remaining));
              remaining -= line.length + 1;
              let consumed = 0;

              return (
                <div key={lineIndex} style={{ minHeight: fontSize * 1.55 }}>
                  {tokenizeLine(line).map((token, tokenIndex) => {
                    const take = Math.max(0, Math.min(token.text.length, visibleInLine - consumed));
                    consumed += token.text.length;
                    return take > 0 ? (
                      <span key={tokenIndex} style={{ color: TOKEN_COLORS[token.kind] }}>
                        {token.text.slice(0, take)}
                      </span>
                    ) : null;
                  })}
                  {remaining < 0 && remaining > -line.length - 2 && frame % 30 < 18 ? (
                    <span style={{ color: theme.accent }}>▍</span>
                  ) : null}
                </div>
              );
            })}
          </pre>
        </div>
      </div>
    </SceneFrame>
  );
}
