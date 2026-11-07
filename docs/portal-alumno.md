# Portal del alumno

El alumno accede con su código y contraseña y encuentra sus asignaturas en el menú lateral. El historial de práctica está asociado al código del alumno, por lo que restablecer la contraseña no lo borra.

## Entrenamiento

Al seleccionar un contenido se incluyen sus descendientes. Los ascendientes se iluminan para situarlo en el mapa, pero sus otros hijos no quedan seleccionados. Un ejercicio solo se propone cuando todos los conceptos de sus apartados pertenecen a los contenidos permitidos. Cada apartado aporta sus puntos a sus propios conceptos y a sus ascendientes, sin duplicar un ascendiente común dentro del mismo apartado. El progreso usa los cinco últimos intentos y es provisional hasta disponer de cinco.

El alumno decide cuándo mostrar la solución; el cronómetro solo avisa una vez al superar el tiempo y puede pausarse o reiniciarse. Se agotan primero los originales y después las variantes; repetir un ejercicio es una opción voluntaria. Solo se ofrecen versiones que tengan conceptos, solución, criterios con puntuaciones positivas y PDF de enunciado y solución compilados. En la programación del grupo hay una herramienta para revisar cuáles necesitan completarse.

En el cuaderno, el profesor puede abrir la ficha de un alumno y consultar la pestaña «Mapa de conceptos». Muestra el progreso procedente de las autoevaluaciones de entrenamiento para la asignatura del grupo, no las calificaciones del cuaderno. El detalle indica el porcentaje, el número de intentos y si el dato es provisional.

## Información compartida

Los resultados y las fechas están ocultos hasta que el profesor los publique. Para publicar un resultado, hay que activar «Mostrar resultado al alumno» al editar el elemento en la configuración del cuaderno. Para publicar una fecha, se edita el día correspondiente en la programación y se usa el icono de visibilidad junto al documento evaluable. Los mensajes se consultan y responden desde el icono situado junto al alumno en el cuaderno.

La evaluación y la generación de ejercicios mediante IA no están activadas en el portal del alumno.

## Puesta en servicio

Además de la aplicación web, esta funcionalidad requiere actualizar las reglas de Firestore y desplegar las funciones `getStudentDashboard`, `getStudentDashboardV2`, `loadStudentTraining`, `startStudentTraining`, `getStudentTrainingPdf`, `updateStudentTraining`, `manageStudentMessages`, `manageTeacherStudentMessages`, `getTeacherStudentTrainingProgress` y `getStudentTrainingReadiness`. Las dos versiones del inicio del alumno filtran la información publicada, también para aplicaciones antiguas. El cambio de reglas impide el acceso directo de alumnos a los datos completos del grupo. Conviene desplegar aplicación, funciones y reglas de forma coordinada.
