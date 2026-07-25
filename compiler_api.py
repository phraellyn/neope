from io import BytesIO
from pathlib import Path
import re
import subprocess
import tempfile

from flask import Flask, jsonify, request, send_file
from flask_cors import CORS
from werkzeug.utils import secure_filename


app = Flask(__name__)
CORS(app)

PREAMBLES_DIR = Path('/app/preambles')
OUTPUT_DIR = Path('/app/output')
COMPILE_TIMEOUT_SECONDS = 30

PREAMBLES_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def normalized_preamble_name(raw_name):
    name = secure_filename(raw_name or '')
    if not name:
        return None
    return name if name.endswith('.tex') else f'{name}.tex'


def compilation_error_excerpt(output, log):
    """Devuelve el primer error de LaTeX con unas pocas líneas de contexto."""
    text = log or output or 'LaTeX no ha proporcionado información adicional.'
    lines = text.splitlines()
    error_index = next(
        (
            index
            for index, line in enumerate(lines)
            if line.startswith('!')
            or re.search(r'\.tex:\d+:', line)
            or 'Fatal error occurred' in line
            or 'Emergency stop' in line
        ),
        None,
    )

    if error_index is None:
        return '\n'.join(lines[-400:])

    start = max(0, error_index - 2)
    end = min(len(lines), error_index + 14)
    return '\n'.join(lines[start:end])


@app.get('/v1/preambles')
def list_preambles():
    files = sorted(path.name for path in PREAMBLES_DIR.glob('*.tex'))
    return jsonify({'preambles': files})


@app.get('/v1/preambles/<name>')
def get_preamble(name):
    normalized_name = normalized_preamble_name(name)
    if not normalized_name:
        return jsonify({'status': 'error', 'message': 'Nombre de preámbulo no válido'}), 400

    path = PREAMBLES_DIR / normalized_name
    if not path.is_file():
        return jsonify({'status': 'error', 'message': 'Preámbulo no encontrado'}), 404

    return jsonify({
        'name': normalized_name,
        'content': path.read_text(encoding='utf-8'),
    })


@app.route('/v1/preambles', methods=['POST', 'PUT'])
def save_preamble():
    data = request.get_json(silent=True) or {}
    normalized_name = normalized_preamble_name(data.get('name'))
    content = data.get('content')

    if not normalized_name or not isinstance(content, str) or not content.strip():
        return jsonify({
            'status': 'error',
            'message': "Faltan parámetros válidos 'name' o 'content'",
        }), 400

    (PREAMBLES_DIR / normalized_name).write_text(content, encoding='utf-8')
    return jsonify({
        'status': 'success',
        'message': f"Preámbulo '{normalized_name}' guardado correctamente",
    })


@app.delete('/v1/preambles/<name>')
def delete_preamble(name):
    normalized_name = normalized_preamble_name(name)
    if not normalized_name:
        return jsonify({'status': 'error', 'message': 'Nombre de preámbulo no válido'}), 400

    path = PREAMBLES_DIR / normalized_name
    if not path.is_file():
        return jsonify({'status': 'error', 'message': 'Preámbulo no encontrado'}), 404

    path.unlink()
    return jsonify({
        'status': 'success',
        'message': f"Preámbulo '{normalized_name}' eliminado",
    })


@app.post('/v1/compile')
def compile_latex():
    data = request.get_json(silent=True) or {}
    code = data.get('code')
    preamble_name = normalized_preamble_name(data.get('preamble_name'))

    if not isinstance(code, str) or not code.strip() or not preamble_name:
        return jsonify({
            'status': 'error',
            'message': "Faltan parámetros válidos 'code' o 'preamble_name'",
        }), 400

    preamble_path = PREAMBLES_DIR / preamble_name
    if not preamble_path.is_file():
        return jsonify({
            'status': 'error',
            'message': f"Preámbulo '{preamble_name}' no encontrado",
        }), 404

    preamble = preamble_path.read_text(encoding='utf-8')
    document = f'{preamble}\n\\begin{{document}}\n{code}\n\\end{{document}}\n'

    try:
        with tempfile.TemporaryDirectory(dir=OUTPUT_DIR) as temporary_directory:
            workdir = Path(temporary_directory)
            tex_path = workdir / 'document.tex'
            pdf_path = workdir / 'document.pdf'
            log_path = workdir / 'document.log'
            tex_path.write_text(document, encoding='utf-8')

            result = subprocess.run(
                [
                    'pdflatex',
                    '-interaction=nonstopmode',
                    '-halt-on-error',
                    '-file-line-error',
                    '-no-shell-escape',
                    f'-output-directory={workdir}',
                    str(tex_path),
                ],
                capture_output=True,
                text=True,
                timeout=COMPILE_TIMEOUT_SECONDS,
                check=False,
            )

            output = '\n'.join(part for part in (result.stdout, result.stderr) if part)
            log = log_path.read_text(encoding='utf-8', errors='replace') if log_path.exists() else ''

            if result.returncode != 0 or not pdf_path.is_file():
                return jsonify({
                    'status': 'error',
                    'message': 'Compilation failed',
                    'log': compilation_error_excerpt(output, log),
                }), 400

            pdf = BytesIO(pdf_path.read_bytes())
            pdf.seek(0)
            return send_file(
                pdf,
                mimetype='application/pdf',
                download_name='document.pdf',
            )
    except subprocess.TimeoutExpired:
        return jsonify({
            'status': 'error',
            'message': f'La compilación ha superado el límite de {COMPILE_TIMEOUT_SECONDS} segundos',
        }), 408


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
