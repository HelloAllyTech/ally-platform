This template outlines the recommended format for creating pull requests within this project. Please follow the given guidelines.

## Branch Naming:

- Use a descriptive branch name that reflects the change and follows the format: [type]/[brief-description]
- Replace [type] with feature, fix, refactor, hotfix, or other relevant categories
- Keep the description concise and clear

## Commit Guidelines:

- Use Conventional Commits format: `type[optional scope]: subject`
- Allowed `type` values: `feat`, `fix`, `docs`, `chore`, `style`, `refactor`, `ci`, `test`, `revert`, `perf`, `build`
- Subject must be in sentence case and must not end with a period
- Write the subject in imperative mood (e.g., "Fix login redirect")
- Examples:
  - `feat: Add biometric login`
  - `fix: Prevent crash when token is missing`
  - `docs: Update setup steps`

Note: Commit messages are enforced by a commit hook (`husky` → `commit-msg`) using `commitlint`.

## Pull Request Checklist:

[ ] **Read the contributing guidelines** <br />
[ ] **Branch is up-to-date with the base branch: main (or other designated branch)**<br />
[ ] **Changes pass all tests: npm test or yarn test (or equivalent command)**<br />
[ ] **Documentation has been updated (if applicable)**<br />

## Description:

- Explain the motivation and the problem it solves
- Mention any breaking changes
- Link to related issues or internal tickets

## Additional Notes:

- Include any other relevant information, such as limitations, known issues, or future improvements.

## Screenshots (if applicable):

- Add screenshots or GIFs to help visualize your changes.

## Testing Instructions:

- Provide step-by-step instructions on how to test your changes

## Checklist for Reviewers:

[ ] **Code follows project conventions and style guidelines**<br />
[ ] **Changes do not introduce new warnings or errors**<br />
[ ] **Unit tests cover the changes adequately**<br />
[ ] **Documentation is updated correctly and reflects the changes**<br />
Additional Information:

By submitting this pull request, I confirm that my contribution is made under the terms of the MIT License.
