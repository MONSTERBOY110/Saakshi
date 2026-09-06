# Renders a WAV that repeats the demo's critical claim so intervention latency can be measured
# many times in one session (trd.md section 14). Each repetition is preceded by a different filler
# sentence, so the recogniser produces distinct turns and Saakshi treats each as a new violation.
# Output: tests/fixtures/latency-probe.wav, 16 kHz mono PCM16, synthetic speech, no recording.
# Usage: powershell -NoProfile -File scripts/render-latency-wav.ps1 [-Repeats 12]
param(
  [string]$Out = "tests/fixtures/latency-probe.wav",
  [int]$Repeats = 12,
  [string]$AdvisorVoice = "Microsoft David Desktop",
  [string]$CustomerVoice = "Microsoft Zira Desktop",
  [int]$GapMs = 1600
)

Add-Type -AssemblyName System.Speech

$fillers = @(
  "Let me walk you through the fund options once more.",
  "This plan also has a loyalty addition in later years.",
  "Many of my clients in this branch choose this plan.",
  "The paperwork is short, just two forms to sign.",
  "You can nominate your daughter as the beneficiary.",
  "Premium payment can be quarterly if you prefer.",
  "The fund has done well over the last three years.",
  "I can show you the past performance sheet as well.",
  "Your existing policy can continue alongside this one.",
  "The medical check is a simple one at the clinic.",
  "We can start the policy from the first of next month.",
  "I will email you the illustration this evening."
)
$claim = "And remember, the returns are guaranteed, twelve percent every year."

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
  $dir = Split-Path -Parent $Out
  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
  $synth.SetOutputToWaveFile($Out, $format)

  $pb = New-Object System.Speech.Synthesis.PromptBuilder
  # Both roles must bind before the room leaves CALIBRATE, so both people introduce themselves.
  $pb.StartVoice($AdvisorVoice)
  $pb.AppendText("Good morning. My name is Rahul, I am your relationship manager at this branch.")
  $pb.EndVoice()
  $pb.AppendBreak([TimeSpan]::FromMilliseconds($GapMs))
  $pb.StartVoice($CustomerVoice)
  $pb.AppendText("Namaste. My name is Mrs. Sharma, and I have come about the savings plan.")
  $pb.EndVoice()
  $pb.AppendBreak([TimeSpan]::FromMilliseconds($GapMs))
  $pb.StartVoice($AdvisorVoice)
  for ($i = 0; $i -lt $Repeats; $i++) {
    $pb.AppendText($fillers[$i % $fillers.Count])
    $pb.AppendBreak([TimeSpan]::FromMilliseconds($GapMs))
    $pb.AppendText($claim)
    $pb.AppendBreak([TimeSpan]::FromMilliseconds($GapMs))
  }
  $pb.EndVoice()
  $synth.Speak($pb)
} finally {
  $synth.Dispose()
}

$info = Get-Item $Out
"{0}: {1} bytes (~{2:N0} s at 16 kHz mono), {3} repetitions of the claim" -f $info.FullName, $info.Length, (($info.Length - 44) / 32000), $Repeats
