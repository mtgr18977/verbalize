# Tech Writer's Assistant

A web application designed to help technical writers improve their documentation by linting it against popular style guides using [Vale](https://vale.sh/).

## Features

- **Multiple Style Guides**: Choose between Google, Microsoft, and Red Hat style guides.
- **Markdown Editor**: A simple text area for writing documentation in Markdown.
- **Real-time Preview**: See how your documentation will look when rendered.
- **On-demand Linting**: Click the "Lint Documentation" button to receive feedback based on the selected style guide.
- **Detailed Alerts**: View specific suggestions, warnings, and errors directly in the app.

## How to Run

1.  **Install Dependencies**:
    ```bash
    npm install
    ```

2.  **Ensure Vale is present**:
    The application expects a `vale` binary in the root directory and styles in the `styles/` folder.

3.  **Start the Development Server**:
    ```bash
    npm run dev
    ```

4.  **Open the App**:
    Navigate to `http://localhost:3000` in your browser.

## Tech Stack

- **Frontend**: Next.js (App Router), React, Tailwind CSS.
- **Backend**: Next.js API Routes, Node.js `child_process` for running Vale.
- **Linting Engine**: Vale.sh
- **Markdown Rendering**: `react-markdown`.

## Project Structure

- `app/`: Next.js application logic.
  - `api/lint/`: Backend API for running Vale.
  - `page.tsx`: Main frontend UI.
- `styles/`: Vale style guides (Google, Microsoft, RedHat).
- `vale`: Vale binary.
- `.vale.ini`: Base Vale configuration.
