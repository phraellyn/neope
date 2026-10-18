# Plantillas de documentos

Cada archivo `.tex` contiene su configuración en comentarios, el preámbulo y
los bloques que envuelven el contenido. `ejercicio.tex` es interna: no se
convierte ni se muestra en el editor de plantillas o en el creador.

```tex
% neope:document {"version":2,"content":"exercises","assessment":true,"command":"logo","exerciseEnvironment":"ejercicios"}
% neope:field {"key":"level","label":"Nivel","type":"level","formOnly":true}
% neope:field {"key":"subject","label":"Asignatura","type":"subject","argument":1}
% neope:field {"key":"title","label":"Título","argument":2}
% neope:field {"key":"date","label":"Fecha","type":"date","argument":3}
% neope:field {"key":"course","label":"Grupo","type":"group","argument":4}
\documentclass{article}
\newcommand{\logo}[4]{#1 -- #2 -- #3 -- #4}
% ...resto del preámbulo y entorno ejercicios...
%%% previo: \begin{document}
%%% previo: {{header}}
%%% final: \end{document}
```

`content` admite `exercises` (ejercicios y herramientas) o `code` (editor de
contenido). `assessment` permite ofrecer «Evaluable». Los campos son obligatorios
salvo `required:false`; `formOnly:true` impide pasarlos como argumentos LaTeX.
Los tipos disponibles son `text`, `date`, `level`, `subject`, `group` y `checkbox`.
Los campos compartidos se unifican por `key`, independientemente de su etiqueta.
`hidden:true` conserva un argumento del preámbulo sin pedirlo en el formulario;
su valor procede de `default`. Por ejemplo, una colección puede usar el nivel
en el cuarto argumento del encabezado y dejar vacía la fecha.

Los marcadores `%% asignatura %%`, `%% título %%`, etc. siguen funcionando en
las líneas de las definiciones donde aparecen `#1`, `#2`, etc. Un campo puede
declarar `command` para aportar argumentos a otro comando del preámbulo.
`{{header}}` invoca los comandos declarados. Los bloques previo/final también
admiten `{{subject}}`, `{{title}}` y otras claves de campos. Para escribir varios
renglones se repite `%%% previo:` o `%%% final:`.

Para colecciones pueden declararse estas opciones:

```tex
% neope:field {"key":"includeInfo","label":"Información de los ejercicios","type":"checkbox","default":true,"formOnly":true}
% neope:field {"key":"includeAnswers","label":"Respuestas breves","type":"checkbox","default":true,"formOnly":true}
% neope:field {"key":"includeSolutions","label":"Soluciones detalladas","type":"checkbox","default":false,"formOnly":true}
% neope:field {"key":"includeCriteria","label":"Criterios de calificación","type":"checkbox","default":true,"formOnly":true}
```

Las herramientas mantienen el formato `% neope:tool {…}` y el formato compacto
`%%% Nombre, descripción, \comando{Argumento}`. `exerciseEnvironment` define el
entorno que envuelve los ejercicios; una cadena vacía evita esa envoltura.

`render` en `neope:document` establece valores fijos para las opciones que no se
ofrecen como campos. El examen resuelto declara `includeSolutions:true` y
`includeAnswers:true`; el examen de enunciados los deja desactivados.

Los documentos guardan campos, contenido, copias de sus plantillas y un código
final independiente por resultado. El editor «Mostrar código» compila exactamente
ese código, incluido su preámbulo. Los cambios en campos y ejercicios conservan
las ediciones finales; «Regenerar desde los datos» las sustituye explícitamente.
Solo se guarda un PDF si corresponde al código final vigente.

El editor de contenido admite pegar un documento completo: utiliza su cuerpo
y deja que la plantilla aporte el preámbulo y las envolturas. Se conserva el
borrador original. Una envoltura exterior `preview` se elimina del contenido
cuando ya la aporta la plantilla. Los códigos finales antiguos que contienen
un documento anidado tras `\input{../teoria}` u otra referencia de preámbulo
se recuperan al abrirlos o compilarlos; los ejemplos en comentarios y entornos
de código literal se mantienen.

Las plantillas antiguas de Firestore se convierten al cargarlas con una sesión de
profesor y se sincronizan con el servidor LaTeX. Las declaraciones explícitas
del formato 2 se respetan. La conversión local se puede ejecutar con:

```sh
node tools/upgrade-document-templates.mjs
```

Las cinco plantillas públicas del proyecto también están en `templates/`.
Para inspeccionar o actualizar Firestore con una sesión de Firebase CLI:

```sh
node tools/upgrade-firestore-templates.mjs
node tools/upgrade-firestore-templates.mjs --apply
node tools/upgrade-firestore-templates.mjs --sync-compiler
```

`--configure` prepara una conversión explícita de las plantillas existentes.
Antes de escribir, el script guarda una copia en `Recursos de desarrollo/backups/`
y exige que el documento remoto no haya cambiado desde su lectura.

Comprobaciones:

```sh
npm run test:document-template
npm run test:document-creator
node tools/check-document-templates.mjs
```

La última comprobación usa el servidor LaTeX con preámbulos temporales y los
elimina al terminar. No requiere desplegar cambios en Cloud Functions.
