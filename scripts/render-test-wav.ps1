# Renders a two-voice WAV of the golden-path script (prd.md section 5) with the offline Windows
# SAPI voices, for headless diarization tests via Chromium's fake audio capture:
#   chromium --use-fake-device-for-media-stream --use-file-for-fake-audio-capture=<wav>
# Output: tests/fixtures/golden-draft.wav, 16 kHz mono PCM16. Synthetic speech, not a recording.
# Usage: powershell -NoProfile -File scripts/render-test-wav.ps1 [-Out tests/fixtures/golden-draft.wav]
param(
  [string]$Out = "tests/fixtures/golden-draft.wav",
  [string]$AdvisorVoice = "Microsoft David Desktop",
  [string]$CustomerVoice = "Microsoft Zira Desktop",
  [int]$GapMs = 1400
)

Add-Type -AssemblyName System.Speech

$lines = @(
  @{ who = "advisor";  text = "Good morning Mrs. Sharma. My name is Rahul." },
  @{ who = "customer"; text = "Namaste. My name is Mrs. Sharma." },
  @{ who = "advisor";  text = "This is a unit linked insurance plan. You pay a premium of fifty thousand rupees every year for ten years, and the policy term is fifteen years." },
  @{ who = "advisor";  text = "The money goes into market linked funds, so the fund value depends on the market. There is a five year lock in." },
  @{ who = "customer"; text = "Isme paisa kab nikal sakti hoon?" },
  @{ who = "advisor";  text = "Anytime, madam, and the returns are guaranteed, twelve percent." },
  @{ who = "advisor";  text = "Sorry, let me correct that. Returns are not guaranteed. There are charges, including premium allocation and fund management charges." },
  @{ who = "advisor";  text = "The benefit illustration shows values at four percent and eight percent. The surrender value applies after the lock in." },
  @{ who = "advisor";  text = "Saakshi, verify." },
  @{ who = "advisor";  text = "You also have a thirty day free look period to return the policy." },
  @{ who = "customer"; text = "Paanch saal, five years, uske baad nikal sakti hoon." }
)

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
  $dir = Split-Path -Parent $Out
  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
  $synth.SetOutputToWaveFile($Out, $format)

  $pb = New-Object System.Speech.Synthesis.PromptBuilder
  $pb.AppendBreak([TimeSpan]::FromMilliseconds(800))
  foreach ($line in $lines) {
    $voice = if ($line.who -eq "advisor") { $AdvisorVoice } else { $CustomerVoice }
    $pb.StartVoice($voice)
    $pb.AppendText($line.text)
    $pb.EndVoice()
    $pb.AppendBreak([TimeSpan]::FromMilliseconds($GapMs))
  }
  $synth.Speak($pb)
} finally {
  $synth.Dispose()
}

$info = Get-Item $Out
"{0}: {1} bytes (~{2:N1} s at 16 kHz mono)" -f $info.FullName, $info.Length, (($info.Length - 44) / 32000)
