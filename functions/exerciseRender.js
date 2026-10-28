import { normalizeAlignedLineBreaks, normalizeDisplayMathDelimiters } from './solutionLayout.js'

export const exerciseRenderProfiles = Object.freeze({
  segment: 'segment',
  statement: 'statement',
  solved: 'solved',
})

function segmentTemplate(code) {
  return `\\noindent
\\hspace*{2.5mm}
\\begin{minipage}{8.5cm}
\\vspace*{2.5mm}
${code.trim()}
\\par
\\vspace*{2.5mm}
\\end{minipage}
\\hspace*{2.5mm}`
}

function completeExerciseTemplate(code) {
  return `\\begin{ejercicios}\n${code.trim()}\n\\end{ejercicios}`
}

export function codeForCompiler(code = '', profile = exerciseRenderProfiles.statement) {
  const normalized = normalizeAlignedLineBreaks(normalizeDisplayMathDelimiters(code))
    .replace(/(\\ej\b(?:\s*\\(?:M|P)\s*\{[^{}]*\})?\s*)\\T\s*\{[^{}]*\}/g, '$1')
    .replace(/(\\ap\b(?:\s*\\p\s*\{[^{}]*\})?\s*)\\t\s*\{[^{}]*\}/g, '$1')
  const body = profile === exerciseRenderProfiles.segment
    ? segmentTemplate(normalized)
    : completeExerciseTemplate(normalized)
  const criteriaFallback = String.raw`\providecommand{\mathbb}[1]{\mathbf{#1}}%
\providecommand{\criterios}[1]{%
\par\vspace{2mm}%
\begingroup
\small%
\setlength{\tabcolsep}{8pt}%
\renewcommand{\arraystretch}{1.35}%
\ifdefined\tabularx
\begin{tabularx}{\linewidth}{|c|X|c|}\hline
#1
\end{tabularx}%
\else
\begin{tabular}{|p{.12\linewidth}|p{.72\linewidth}|c|}\hline
#1
\end{tabular}%
\fi
\endgroup
}`
  return `\\shorthandoff{<>}\n${criteriaFallback}\n${body}`
}
