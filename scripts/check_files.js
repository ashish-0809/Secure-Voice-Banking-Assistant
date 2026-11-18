// Checks that all project files are present (detects an incomplete zip/copy). Usage: node scripts/check_files.js
const fs = require('fs'), path = require('path');
const need = ['START_APP.bat', 'START_APP_DEBUG.bat', 'MAKE_REPORT.bat', 'MAKE_PUBLIC_REPORT.bat', 'MAKE_TRAIN100_REPORT.bat', 'MAKE_PAPER_FILES.bat', 'ml/eval/paper_export.py', 'REPORT_FROM_SCORES.bat', 'ml/eval/make_scores.py', 'colab/ECAPA_scores.ipynb', 'package.json', 'server.js', 'public/index.html', 'public/app.js', 'public/style.css',
  'lib/speaker.js', 'lib/replay.js', 'lib/metrics.js', 'lib/reportHtml.js', 'lib/wav.js', 'lib/policy.js', 'lib/challenge.js', 'lib/store.js',
  'scripts/make_report.js', 'scripts/last_verify.js', 'scripts/calibrate_samples.js', 'tests/smoke.test.js',
  'speaker_service/app.py', 'ml/service/speaker.py', 'ml/common/audio.py', 'ml/start_speaker_service.ps1', 'ml/setup_windows.ps1'];
const root = path.join(__dirname, '..');
const missing = need.filter(f => !fs.existsSync(path.join(root, f)));
console.log(missing.length ? 'MISSING:\n  ' + missing.join('\n  ') : `All ${need.length} required files present.`);
for (const d of ['node_modules', 'ml/.venv', 'data/store.json']) console.log(`${fs.existsSync(path.join(root, d)) ? 'found  ' : 'absent '} ${d}`);
process.exit(missing.length ? 1 : 0);
