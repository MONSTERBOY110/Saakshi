# Renders the omitted-disclosures WAV for the keyterms-integrity experiment
# (tests/e2e/keyterms.live.spec.ts, docs/decisions.md 2026-09-09).
#
# Same voices and format as render-test-wav.ps1, but the advisor makes only FOUR of the eight
# required disclosures (premium and term, policy term, market risk, five-year lock-in) and never
# mentions charges, the benefit illustration, surrender value or the free-look period. In their
# place he says acoustic neighbours of those phrases ("free book", "fund manager", "tees at the golf
# club", "surrounding valley", "illustrate the layout", "location of our office"). Any tick on the
# four omitted cards is a false attestation; any flag is a false claim. No prohibited claim is made.
#
# Output: tests/fixtures/omitted-draft.wav, 16 kHz mono PCM16. Synthetic speech, not a recording.
# Usage: powershell -NoProfile -File scripts/render-omitted-wav.ps1 [-Out tests/fixtures/omitted-draft.wav]
param(
  [string]$Out = "tests/fixtures/omitted-draft.wav",
  [string]$AdvisorVoice = "Microsoft David Desktop",
  [string]$CustomerVoice = "Microsoft Zira Desktop",
  [int]$GapMs = 1400
)

Add-Type -AssemblyName System.Speech

$lines = @(
  @{ who = "advisor";  text = "Good morning Mrs. Sharma. My name is Rahul, I am your relationship manager at the branch." },
  @{ who = "customer"; text = "Namaste. My name is Mrs. Sharma." },
  @{ who = "advisor";  text = "This is a unit linked insurance plan. You pay a premium of fifty thousand rupees every year for ten years, and the policy term is fifteen years." },
  @{ who = "advisor";  text = "The money goes into market linked funds, so the fund value depends on the market." },
  @{ who = "advisor";  text = "There is a five year lock in." },
  @{ who = "customer"; text = "Isme paisa kab nikal sakti hoon?" },
  @{ who = "advisor";  text = "After five years you can take the money out." },
  @{ who = "advisor";  text = "Our branch is on the second floor, and there is a free book about the plan at the front desk." },
  @{ who = "advisor";  text = "I will send you the brochure with a picture of the fund manager on the cover." },
  @{ who = "advisor";  text = "The tees at the golf club near the branch are open till thirty past eight." },
  @{ who = "advisor";  text = "There is a surrounding valley view from the office, which many customers like." },
  @{ who = "advisor";  text = "My colleague will illustrate the branch layout on a map for you." },
  @{ who = "advisor";  text = "The location of our office changed last week, so please use the new gate." },
  @{ who = "advisor";  text = "Do you have any questions so far?" },
  @{ who = "customer"; text = "Nahi, theek hai. Thank you." }
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
