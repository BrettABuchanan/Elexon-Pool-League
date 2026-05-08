#!/bin/bash
# Double-click this file to start a local web server for the Pool League app.
# Then open http://localhost:8000 in your browser.
cd "$(dirname "$0")"
echo "Starting Pool League dev server at http://localhost:8000 ..."
echo "Close this window or press Ctrl+C to stop."
python3 -m http.server 8000
