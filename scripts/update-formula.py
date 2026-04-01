#!/usr/bin/env python3
"""Write the Homebrew formula for fcc to tap-repo/Formula/fcc.rb.
Reads VERSION, SHA256_ARM64, SHA256_X64 from environment variables.
"""
import os

version = os.environ['VERSION'].lstrip('v')
tag     = os.environ['VERSION']
arm64   = os.environ['SHA256_ARM64']
x64     = os.environ['SHA256_X64']

formula = f'''class Fcc < Formula
  desc "Free Claude Code - AI coding assistant using Groq (free), OpenAI, or Gemini"
  homepage "https://github.com/albertgd/free-claude-code"
  version "{version}"

  on_macos do
    on_arm do
      url "https://github.com/albertgd/free-claude-code/releases/download/{tag}/fcc-macos-arm64"
      sha256 "{arm64}"
    end
    on_intel do
      url "https://github.com/albertgd/free-claude-code/releases/download/{tag}/fcc-macos-x64"
      sha256 "{x64}"
    end
  end

  def install
    binary = Hardware::CPU.arm? ? "fcc-macos-arm64" : "fcc-macos-x64"
    bin.install binary => "fcc"
    chmod 0755, bin/"fcc"
  end

  test do
    assert_match version.to_s, shell_output("#{{bin}}/fcc --version 2>&1")
  end
end
'''

os.makedirs('tap-repo/Formula', exist_ok=True)
with open('tap-repo/Formula/fcc.rb', 'w') as f:
    f.write(formula)

print(f'Formula written for v{version}')
