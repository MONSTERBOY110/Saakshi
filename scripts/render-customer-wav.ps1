# Renders a customer-only WAV for testing judge-solo mode (prd.md P0-10). In judge-solo the
# pre-rendered advisor is mixed into the microphone stream by the room itself, so the fake
# microphone must carry only Mrs. Sharma. Long silences between her lines let the advisor's script
# play in the gaps; his customer_turn waits time out after 15 s, so exact alignment is not needed.
#
# Output: tests/fixtures/judge-solo-customer.wav, 16 kHz mono PCM16. Synthetic speech, not a recording.
# Usage: powershell -NoProfile -File scripts/render-customer-wav.ps1
param(
  [string]$Out = "tests/fixtures/judge-solo-customer.wav",
  [string]$CustomerVoice = "Microsoft Zira Desktop"
)

Add-Type -AssemblyName System.Speech

# leadMs is silence before the line. A recording cannot listen, so it cannot choose its moment the
# way a judge does; her introduction is therefore repeated, because binding her role needs only one
# turn that lands in a gap, and a person asked again for their name simply says it again.
$lines = @(
  @{ leadMs = 20000; text = "Namaste. My name is Mrs. Sharma." },
  @{ leadMs = 21000; text = "My name is Mrs. Sharma." },
  @{ leadMs = 21000; text = "Namaste, I am Mrs. Sharma." },
  @{ leadMs = 18000; text = "Isme paisa kab nikal sakti hoon?" },
  @{ leadMs = 20000; text = "Achha, theek hai." },
  @{ leadMs = 20000; text = "Paanch saal, five years, uske baad nikal sakti hoon." },
  @{ leadMs = 14000; text = "Market gire to fund value kam ho jaayegi." },
  @{ leadMs = 14000; text = "Kuch charges lagte hain, pata nahi kaunse." },
  @{ leadMs = 14000; text = "Tees din ke andar policy wapas kar sakti hoon." }
)

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
  $dir = Split-Path -Parent $Out
  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
  $synth.SetOutputToWaveFile($Out, $format)

  $pb = New-Object System.Speech.Synthesis.PromptBuilder
  $pb.StartVoice($CustomerVoice)
  foreach ($line in $lines) {
    $pb.AppendBreak([TimeSpan]::FromMilliseconds($line.leadMs))
    $pb.AppendText($line.text)
  }
  $pb.EndVoice()
  $synth.Speak($pb)
} finally {
  $synth.Dispose()
}

$info = Get-Item $Out
"{0}: {1} bytes (~{2:N1} s at 16 kHz mono)" -f $info.FullName, $info.Length, (($info.Length - 44) / 32000)
