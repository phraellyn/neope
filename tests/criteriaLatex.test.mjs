import assert from 'node:assert/strict'
import { criteriaCellText, normalizeGeneratedCriterionMath } from '../functions/criteriaLatex.js'
import { criterionMathInstructions } from '../functions/achievementGranularity.js'
import { renderMathText } from '../src/utils/mathText.js'

assert.match(criterionMathInstructions, /\$\.\.\.\$/)
assert.match(criterionMathInstructions, /todas las expresiones matemáticas/i)
const original = String.raw`Calcula $f'(x)=\frac{1}{x}$ y usa $x_1$ en $\mathbb{R}$.`
assert.equal(normalizeGeneratedCriterionMath(original), original, 'Se conserva el LaTeX ya delimitado')
assert.equal(criteriaCellText(original), original, 'La compilación conserva las fórmulas explícitas')
const parens = String.raw`Verifica \(x_1\leq 2\) y \(f(x)=x^2\).`
assert.equal(criteriaCellText(parens), parens, 'Se respeta el modo matemático con paréntesis')
const display = String.raw`Comprueba $$x_1=x^2$$.`
assert.equal(criteriaCellText(display), display, 'Se respeta el modo matemático con dobles dólares')
const corrected = normalizeGeneratedCriterionMath('Domino: $x≥0$ y $A∪B$ en ℝ.')
assert.equal(corrected, String.raw`Domino: $x\geq{}0$ y $A\cup{}B$ en $\mathbb{R}$.`)
assert.equal(renderMathText(corrected).filter((part) => part.html).length, 3, 'KaTeX interpreta las fórmulas generadas')
assert.doesNotMatch(criteriaCellText(corrected), /[≥∪ℝ]/)
const outside = normalizeGeneratedCriterionMath('Comprueba que x ≥ 0 y A ∩ B es vacío.')
assert.equal(outside, String.raw`Comprueba que x $\geq$ 0 y A $\cap$ B es vacío.`)
assert.equal(normalizeGeneratedCriterionMath('Calcula x² y $y³$.'), String.raw`Calcula $x^{2}$ y $y^{3}$.`)
assert.equal(normalizeGeneratedCriterionMath(String.raw`$\text{ángulo π}$`), String.raw`$\text{ángulo π}$`, 'Se conserva el contenido de comandos de texto')
assert.equal(normalizeGeneratedCriterionMath('Reduce a común denominador.'), 'Reduce a común denominador.')
console.log('Criterios: instrucciones, símbolos y fórmulas LaTeX verificadas.')
