#!/usr/bin/env bash
# Prepare an isolated GNUPGHOME with the TEST-ONLY fixture keys and export the settings the test
# suites read (GNUPGHOME, GPG_BIN). Used by both the `test` (Vitest) and `e2e` (real Obsidian) jobs
# in ci.yml — keep it in one place, the Windows handling below is easy to get subtly wrong.
#
# Requires: bash (Git Bash on Windows, so Git-for-Windows' gpg.exe is on PATH), $GITHUB_ENV.
set -euo pipefail

if [ "${RUNNER_OS:-}" = "Windows" ]; then
	# Git for Windows' gpg is an MSYS build: it needs the POSIX spelling (C:/… is taken as a
	# RELATIVE path → "no writable keyring found"); keep it short (< 80 chars, gpg-agent limit)
	export GNUPGHOME="/c/gnupg-ci"
	# When bash execs a NATIVE program (node.exe) the MSYS runtime rewrites POSIX-looking env
	# values (/c/gnupg-ci → C:/gnupg-ci), and the MSYS gpg that node then spawns takes that as
	# relative again. Exclude GNUPGHOME from that conversion so node passes it through verbatim.
	echo "MSYS2_ENV_CONV_EXCL=GNUPGHOME" >> "$GITHUB_ENV"
else
	export GNUPGHOME="/tmp/gnupghome-ci" # short: unix socket path limit (104 on macOS)
fi

echo "GNUPGHOME=$GNUPGHOME" >> "$GITHUB_ENV"
mkdir -p "$GNUPGHOME"
[ "${RUNNER_OS:-}" = "Windows" ] || chmod 700 "$GNUPGHOME"
printf 'batch\nno-tty\npinentry-mode loopback\ntrust-model always\n' > "$GNUPGHOME/gpg.conf"
printf 'allow-loopback-pinentry\n' > "$GNUPGHOME/gpg-agent.conf"

gpg --version | head -1
gpg --batch --import tests/fixtures/keys/nopass.private.asc
gpg --batch --pinentry-mode loopback --passphrase test --import tests/fixtures/keys/pw.private.asc
gpg --list-secret-keys --with-colons | grep -c '^sec'

echo "GPG_BIN=gpg" >> "$GITHUB_ENV"
