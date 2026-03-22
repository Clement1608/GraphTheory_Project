from __future__ import annotations

from pathlib import Path

from flask import Flask, jsonify, render_template, request, send_file
from werkzeug.exceptions import NotFound

from generate_traces import (
    append_trace_entry,
    build_action_trace,
    build_graph_overview,
    build_path_trace,
    build_step_trace,
)
from graph_utils import extract_graph_number, graph_payload, list_graphs


app = Flask(__name__)
TRACE_FILE = Path(__file__).resolve().parent / "execution_traces.txt"


@app.get("/")
def index():
    graphs = list_graphs()
    initial_graph = graphs[0] if graphs else None
    graph_choices = [
        {
            "name": graph,
            "label": f"Graph {extract_graph_number(graph)} ({graph})"
            if extract_graph_number(graph) is not None
            else graph,
        }
        for graph in graphs
    ]
    return render_template("index.html", graphs=graph_choices, initial_graph=initial_graph)


@app.get("/api/graphs")
def graphs():
    return jsonify({"graphs": list_graphs()})


@app.get("/api/graphs/<path:graph_name>")
def graph_data(graph_name: str):
    try:
        return jsonify(graph_payload(graph_name))
    except FileNotFoundError as exc:
        raise NotFound(str(exc)) from exc


@app.post("/api/trace")
def append_trace():
    payload = request.get_json(silent=True) or {}
    action = payload.get("action")
    graph_name = payload.get("graphName")

    if not graph_name:
        return jsonify({"error": "Missing graph name."}), 400

    try:
        if action == "load_graph":
            entry = build_graph_overview(graph_name)
        elif action == "highlight_path":
            start = int(payload["start"])
            end = int(payload["end"])
            entry = build_path_trace(graph_name, start, end)
        elif action == "matrix_view":
            matrix_type = str(payload["matrixType"])
            entry = build_action_trace(graph_name, f"Switched to the {matrix_type} matrix view.")
        elif action == "step_change":
            step = int(payload["step"])
            entry = build_step_trace(graph_name, step)
        elif action == "move_node":
            node_id = int(payload["nodeId"])
            x = int(payload["x"])
            y = int(payload["y"])
            entry = build_action_trace(graph_name, f"Moved vertex {node_id} to ({x}, {y}).")
        elif action == "reset_layout":
            entry = build_action_trace(graph_name, "Reset the graph layout to its default positions.")
        else:
            return jsonify({"error": "Unsupported trace action."}), 400
    except FileNotFoundError as exc:
        raise NotFound(str(exc)) from exc
    except (KeyError, TypeError, ValueError):
        return jsonify({"error": "Invalid trace payload."}), 400

    append_trace_entry(entry)
    return jsonify({"status": "ok"})


@app.get("/api/trace/download")
def download_trace():
    if not TRACE_FILE.exists():
        raise NotFound("execution_traces.txt was not found.")
    return send_file(TRACE_FILE, as_attachment=True, download_name="execution_traces.txt")


@app.errorhandler(NotFound)
def not_found(error: NotFound):
    if str(error).startswith("404 Not Found:"):
        description = error.description or "Resource not found."
    else:
        description = str(error)
    return jsonify({"error": description}), 404


if __name__ == "__main__":
    app.run(debug=True)
