#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/load-test-shortlink.sh --url URL [--rate 267] [--duration 30s] [--name NAME] [--redirects -1]

Examples:
  scripts/load-test-shortlink.sh --url https://go.example.com/home
  scripts/load-test-shortlink.sh --url https://go.example.com/scheduled-link --rate 400 --duration 45s
  scripts/load-test-shortlink.sh --url https://go.example.com/home --redirects 10

Notes:
  - Requires vegeta to be installed and available on PATH.
  - By default this does not follow redirects, so it measures the shortlink service itself.
  - Writes results under a temporary directory and prints the paths at the end.
EOF
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

url=""
rate="267"
duration="30s"
name=""
redirects="-1"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --url)
      url="${2:-}"
      shift 2
      ;;
    --rate)
      rate="${2:-}"
      shift 2
      ;;
    --duration)
      duration="${2:-}"
      shift 2
      ;;
    --name)
      name="${2:-}"
      shift 2
      ;;
    --redirects)
      redirects="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$url" ]]; then
  echo "--url is required." >&2
  usage >&2
  exit 1
fi

require_command vegeta

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
safe_name="${name:-$(printf '%s' "$url" | sed 's#^https\?://##; s#[^A-Za-z0-9._-]#-#g')}"
output_dir="${TMPDIR:-/tmp}/go-links-load-test-${safe_name}-${timestamp}"
mkdir -p "$output_dir"

targets_file="$output_dir/targets.txt"
results_file="$output_dir/results.bin"
summary_file="$output_dir/report.txt"
histogram_file="$output_dir/histogram.txt"
plot_file="$output_dir/plot.html"

printf 'GET %s\n' "$url" >"$targets_file"

echo "Running load test"
echo "  url:      $url"
echo "  rate:     $rate req/s"
echo "  duration: $duration"
echo "  redirects:$redirects"
echo "  output:   $output_dir"
echo

vegeta attack \
  -targets="$targets_file" \
  -rate="$rate" \
  -duration="$duration" \
  -redirects="$redirects" \
  >"$results_file"

vegeta report <"$results_file" | tee "$summary_file"
echo
vegeta report -type='hist[0,50ms,100ms,200ms,500ms,1s,2s,5s]' <"$results_file" | tee "$histogram_file"
vegeta plot <"$results_file" >"$plot_file"

echo
echo "Artifacts"
echo "  summary:   $summary_file"
echo "  histogram: $histogram_file"
echo "  plot:      $plot_file"
echo "  raw:       $results_file"
