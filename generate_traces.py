from __future__ import annotations

from pathlib import Path

from graph_utils import (
    floyd_warshall_with_steps,
    graph_payload,
    has_absorbing_circuit,
    list_graphs,
    read_graph,
    serialize_predecessor_matrix,
    serialize_matrix,
)


OUTPUT_PATH = Path("execution_traces.txt")


def format_matrix(title: str, matrix: list[list[object]]) -> str:
    widths = []
    for column in range(len(matrix[0])):
        column_values = [str(row[column]) for row in matrix]
        widths.append(max(len(str(column)), *(len(value) for value in column_values), 3))

    header = " " * 6 + "".join(f"{column:>{widths[column] + 2}}" for column in range(len(matrix[0])))
    lines = [title, header]

    for row_index, row in enumerate(matrix):
        values = "".join(f"{str(value):>{widths[column] + 2}}" for column, value in enumerate(row))
        lines.append(f"{row_index:<6}{values}")

    return "\n".join(lines)


def build_graph_overview(graph_name: str) -> str:
    graph = read_graph(graph_name)
    lines = [
        "=" * 72,
        f"Graph {graph.graph_number if graph.graph_number is not None else graph.name}",
        f"File: {graph.name}",
        f"Vertices: {graph.vertex_count}",
        f"Edges: {graph.edge_count}",
        "Arc list:",
    ]

    lines.extend(f"  {start} -> {end} (weight = {weight})" for start, end, weight in graph.edges)
    lines.append("")
    return "\n".join(lines)


def build_path_trace(graph_name: str, start: int, end: int) -> str:
    payload = graph_payload(graph_name)
    steps = payload["floydWarshall"]["steps"]
    lines = [
        f"Path request: {start} -> {end}",
    ]

    if payload["floydWarshall"]["hasAbsorbingCircuit"]:
        lines.append("Result: blocked because the graph contains an absorbing circuit.")
        lines.append("")
        return "\n".join(lines)

    result = payload["floydWarshall"]["shortestPaths"].get(f"{start}-{end}")
    if not result:
        lines.append("Result: no path found.")
        lines.append("")
        return "\n".join(lines)

    lines.append(f"Distance: {result['distance']}")
    lines.append(f"Path: {' -> '.join(str(vertex) for vertex in result['path'])}")

    relevant_updates = []
    for step_index, step in enumerate(steps):
        matching_updates = [
            update for update in step["updates"]
            if update["from"] == start and update["to"] == end
        ]
        if matching_updates:
            relevant_updates.append((step_index, step["label"], matching_updates))

    if relevant_updates:
        lines.append("Relevant Floyd-Warshall updates:")
        for step_index, label, updates in relevant_updates:
            lines.append(f"  Step {step_index}: {label}")
            for update in updates:
                lines.append(
                    f"    {update['from']} -> {update['to']} via {update['via']} = {update['new_distance']}"
                )
    else:
        lines.append("Relevant Floyd-Warshall updates: none")

    lines.append("")
    return "\n".join(lines)


def build_action_trace(graph_name: str, description: str) -> str:
    graph = read_graph(graph_name)
    graph_label = graph.graph_number if graph.graph_number is not None else graph.name
    return "\n".join(
        [
            f"Graph {graph_label} action:",
            f"  {description}",
            "",
        ]
    )


def append_trace_entry(entry: str) -> None:
    needs_separator = OUTPUT_PATH.exists() and OUTPUT_PATH.read_text(encoding="utf-8").strip()
    prefix = "\n" if needs_separator and not entry.startswith("=" * 72) else ""
    with OUTPUT_PATH.open("a", encoding="utf-8") as output:
        output.write(f"{prefix}{entry}")


def build_trace(graph_name: str) -> str:
    graph = read_graph(graph_name)
    distances, predecessors, next_node, steps = floyd_warshall_with_steps(graph.vertex_count, graph.edges)
    payload = graph_payload(graph_name)
    absorbing = has_absorbing_circuit(distances)

    lines = [build_graph_overview(graph_name)]

    for step_index, step in enumerate(steps):
        label = step["label"]
        lines.append(f"Step {step_index}: {label}")
        lines.append(format_matrix("L matrix", step["distanceMatrix"]))
        lines.append(format_matrix("P matrix", step["predecessorMatrix"]))

        updates = step["updates"]
        if updates:
            lines.append("Updates:")
            lines.extend(
                f"  {update['from']} -> {update['to']} via {update['via']} = {update['new_distance']}"
                for update in updates
            )
        else:
            lines.append("Updates: none")
        lines.append("")

    lines.append(
        "Absorbing circuit: yes" if absorbing else "Absorbing circuit: no"
    )

    if absorbing:
        lines.append("Shortest paths are not displayed because minimum values are not well-defined.")
    else:
        lines.append("Shortest paths:")
        shortest_paths = payload["floydWarshall"]["shortestPaths"]
        if shortest_paths:
            for key, result in shortest_paths.items():
                start, end = key.split("-")
                path = " -> ".join(str(vertex) for vertex in result["path"])
                lines.append(f"  {start} -> {end}: distance {result['distance']} | path {path}")
        else:
            lines.append("  No reachable pair of distinct vertices.")

    lines.append("")
    return "\n".join(lines)


def main() -> None:
    traces = [build_trace(graph_name) for graph_name in list_graphs()]
    OUTPUT_PATH.write_text("\n".join(traces), encoding="utf-8")
    print(f"Wrote {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
