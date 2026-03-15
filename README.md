# Graph Theory Flask Visualizer

This project now exposes the notebook logic as a Flask application with a D3.js frontend.

## Run locally

1. Create and activate a virtual environment.
2. Install dependencies with `pip install -r requirements.txt`.
3. Start the server with `flask --app app run --debug`.
4. Open the local URL shown by Flask in your browser.
5. Generate the execution traces file with `python3 generate_traces.py`.

## Features

- Loads graph files from `Graphs/`
- Renders the directed weighted graph with D3.js
- Shows Floyd-Warshall `L` and `P` matrices step by step
- Detects absorbing circuits
- Highlights shortest paths between selected vertices when no absorbing circuit is present
- Generates `execution_traces.txt` for all bundled test graphs
