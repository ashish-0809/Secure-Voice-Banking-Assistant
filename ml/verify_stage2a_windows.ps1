# Run from the project root with the ml virtual environment activated.
# Saves the full test output in stage2a_laptop.txt.
$ErrorActionPreference = 'Continue'
$log = 'stage2a_laptop.txt'
"=== Stage 2A Windows verification: $(Get-Date -Format o) ===" | Tee-Object -FilePath $log
python --version 2>&1 | Tee-Object -FilePath $log -Append
python -m unittest discover -s ml\tests -t . -v 2>&1 | Tee-Object -FilePath $log -Append
"`n=== soundfile / FLAC check ===" | Tee-Object -FilePath $log -Append
python -c "import soundfile as sf, numpy as np; sf.write('stage2a_test.flac', (0.3*np.sin(2*np.pi*220*np.arange(32000)/16000)).astype('float32'), 16000); print('soundfile', sf.__version__, 'format', sf.info('stage2a_test.flac').format)" 2>&1 | Tee-Object -FilePath $log -Append
python -c "from ml.common import audio; p=audio.preprocess('stage2a_test.flac'); print('FLAC OK', p['sr'], round(p['duration_sec'], 2))" 2>&1 | Tee-Object -FilePath $log -Append
"`n=== Environment check ===" | Tee-Object -FilePath $log -Append
python ml\check_env.py 2>&1 | Tee-Object -FilePath $log -Append
"`nSaved log to $log"
