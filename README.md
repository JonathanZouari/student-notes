git checkout feature/add-contributors-page
git add contributors.md README.md
git commit -F - << 'EOF'
feat: add contributors.md and link from README

- Add contributors.md with table of 4 project contributors
- Include role and short description per contributor
- Add GitHub contributors badge
- Add "How to join" section with step-by-step guide
- Update README.md: add link to contributors page
EOF
git push origin feature/add-contributors-page
