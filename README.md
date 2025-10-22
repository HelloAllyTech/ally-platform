# Ally Mobile App

A React Native mobile application designed to facilitate communication between medical counsellors and their clients.

> This repository is now open source under the MIT License. See `LICENSE`.

## Features

- Secure, privacy-first counselor–client sessions
- Live audio streaming with transcription
- Detailed call summaries
- Conversation analytics and reporting

## Tech Stack

- **Framework:** React Native 0.79.1
- **Language:** TypeScript 5.0.4
- **State Management:** Redux Toolkit
- **Navigation:** React Navigation v7
- **Styling:** React Native Size Matters
- **Storage:** AsyncStorage
- **Network:** Socket.IO Client
- **Code Quality:**
  - ESLint
  - Prettier
  - Husky
  - Commitlint
  - TypeScript
  - Lint-staged

## Project Structure

```
src/
├── assets/         # Static assets and resources
├── components/     # Reusable UI components
├── config/         # App configuration files
├── constants/      # Global constants and enums
├── hooks/          # Custom React hooks
├── navigation/     # Navigation configuration
├── screens/        # Screen components
├── services/       # API and service integrations
├── store/          # Redux store and slices
├── theme/          # Styling and theming
├── types/          # TypeScript type definitions
└── utils/          # Utility functions
```

## Design System

### Theme Configuration

The app uses a robust theming system located in `src/theme/`:

- `colors.ts`: Color palette definitions
- `typography.ts`: Text styles and font configurations
- `fonts.ts`: Font family definitions
- `helpers.ts`: Theme utility functions

## Getting Started

### Prerequisites

- Node.js >= 18
- Ruby (for iOS development)
- Xcode (for iOS development)
- Android Studio (for Android development)
- CocoaPods (for iOS dependencies)

### Installation

1. Clone the repository
2. Install dependencies:

   ```bash
   npm install
   ```

3. iOS specific setup:

   ```bash
   bundle install
   bundle exec pod install
   ```

4. Configure environment variables

   Create an `.env` file in the repository root based on `.env.example`.

   ```bash
   cp .env.example .env
   ```

   This app uses `react-native-config`. The variables are documented in `env/.env.example` and consumed from `src/config/env.ts`.

5. Configure platform secrets

   - iOS: Add your Firebase `GoogleService-Info.plist` at `ios/GoogleService-Info.plist` (excluded from git).
   - Android: Add your Firebase `google-services.json` at `android/app/google-services.json` (excluded from git).
   - Android release signing: Provide your own keystore and signing configuration locally. Keystores must never be committed.

### Running the App

#### iOS

```bash
npm run ios
```

#### Android

```bash
npm run android
```

#### Start Metro Server

```bash
npm start
```

## Development

### Code Quality

The project uses several tools to maintain code quality:

- **ESLint & Prettier**: Code style and formatting

  ```bash
  npm run lint
  ```

- **Import Organization**: The project enforces a strict import grouping order:

  1. Built-in Node.js modules
  2. External dependencies (npm packages, with React first)
  3. Internal modules (using @ alias)
  4. Parent/sibling imports (relative)
  5. Index files
  6. Type imports

  Imports are separated by newlines and alphabetically sorted within their groups.

  Example:

  ```typescript
  import {useEffect} from 'react';
  import AsyncStorage from '@react-native-async-storage/async-storage';
  import {View} from 'react-native';

  import {useAppTheme} from '@/hooks';

  import {styles} from './styles';
  import {ComponentProps} from './types';
  ```

- **TypeScript**: Static type checking
- **Husky**: Git hooks for pre-commit checks
- **Lint-staged**: Run linters on staged files

### Commit Convention

The project follows the Conventional Commits specification with the following types:

- `feat`: New features
- `fix`: Bug fixes
- `docs`: Documentation changes
- `chore`: Maintenance tasks
- `style`: Code style changes
- `refactor`: Code refactoring
- `ci`: CI/CD changes
- `test`: Test updates
- `revert`: Revert changes
- `perf`: Performance improvements
- `build`: Build system changes

Commit messages should be in sentence-case and should not end with a period.

## Architecture Patterns

- **Component-Based Architecture**: Reusable UI components in `src/components`
- **Redux Pattern**: Centralized state management using Redux Toolkit
- **Navigation Pattern**: Stack-based navigation using React Navigation
- **Theme Provider Pattern**: Global theming system
- **Custom Hooks Pattern**: Reusable logic in custom hooks

## Scripts

- `npm start`: Start the Metro bundler
- `npm run ios`: Build and run iOS app
- `npm run android`: Build and run Android app
- `npm run lint`: Run ESLint
- `npm test`: Run tests
- `npm run lint-staged`: Run linters on staged files

# Getting Started

> **Note**: Make sure you have completed the [Set Up Your Environment](https://reactnative.dev/docs/set-up-your-environment) guide before proceeding.

## Step 1: Start Metro

First, you will need to run **Metro**, the JavaScript build tool for React Native.

To start the Metro dev server, run the following command from the root of your React Native project:

```sh
# Using npm
npm start

# OR using Yarn
yarn start
```

## Step 2: Build and run your app

With Metro running, open a new terminal window/pane from the root of your React Native project, and use one of the following commands to build and run your Android or iOS app:

### Android

```sh
# Using npm
npm run android

# OR using Yarn
yarn android
```

### iOS

For iOS, remember to install CocoaPods dependencies (this only needs to be run on first clone or after updating native deps).

The first time you create a new project, run the Ruby bundler to install CocoaPods itself:

```sh
bundle install
```

Then, and every time you update your native dependencies, run:

```sh
bundle exec pod install
```

For more information, please visit [CocoaPods Getting Started guide](https://guides.cocoapods.org/using/getting-started.html).

```sh
# Using npm
npm run ios

# OR using Yarn
yarn ios
```

If everything is set up correctly, you should see your new app running in the Android Emulator, iOS Simulator, or your connected device.

This is one way to run your app — you can also build it directly from Android Studio or Xcode.

### Now what?

- If you want to add this new React Native code to an existing application, check out the [Integration guide](https://reactnative.dev/docs/integration-with-existing-apps).
- If you're curious to learn more about React Native, check out the [docs](https://reactnative.dev/docs/getting-started).

# Troubleshooting

If you're having issues getting the above steps to work, see the [Troubleshooting](https://reactnative.dev/docs/troubleshooting) page.

# Learn More

To learn more about React Native, take a look at the following resources:

- [React Native Website](https://reactnative.dev) - learn more about React Native.
- [Getting Started](https://reactnative.dev/docs/environment-setup) - an **overview** of React Native and how setup your environment.
- [Learn the Basics](https://reactnative.dev/docs/getting-started) - a **guided tour** of the React Native **basics**.
- [Blog](https://reactnative.dev/blog) - read the latest official React Native **Blog** posts.
- [`@facebook/react-native`](https://github.com/facebook/react-native) - the Open Source; GitHub **repository** for React Native.

## Pull Request Guidelines

Before opening a PR, please review our guidelines to avoid duplication:

- Contributing Guide: see [CONTRIBUTING.md](CONTRIBUTING.md)
- Pull Request Template: use [.github/PULL_REQUEST_TEMPLATE.md](.github/PULL_REQUEST_TEMPLATE.md)

## Code of Conduct

This project adheres to a Code of Conduct. By participating, you are expected to uphold it. See `CODE_OF_CONDUCT.md`.

## Security

If you discover a security vulnerability, please follow the steps in `SECURITY.md` and do not open a public issue with sensitive details.
