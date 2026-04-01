.PHONY: build package release clean dev

build:
	npm run build

dev:
	node dist/index.js

package: build
	node scripts/package.mjs

clean:
	rm -rf dist/ binaries/

# Create a release tag and push — GitHub Actions handles the rest
# Usage: make release VERSION=1.0.1
release:
	@[ -n "$(VERSION)" ] || (echo "Usage: make release VERSION=x.y.z" && exit 1)
	@echo "Updating version in package.json..."
	@node -e " \
		const fs = require('fs'); \
		const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')); \
		pkg.version = '$(VERSION)'; \
		fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n'); \
	"
	@node -e " \
		const fs = require('fs'); \
		let src = fs.readFileSync('src/index.ts', 'utf8'); \
		src = src.replace(/const VERSION = '[^']+';/, \"const VERSION = '$(VERSION)';\"); \
		fs.writeFileSync('src/index.ts', src); \
	"
	git add package.json src/index.ts
	git commit -m "chore: bump version to $(VERSION)"
	git tag "v$(VERSION)"
	git push origin main
	git push origin "v$(VERSION)"
	@echo "Tag v$(VERSION) pushed — GitHub Actions will build and publish the release."
