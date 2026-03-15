from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re


INF = float("inf")
GRAPH_DIR = Path(__file__).resolve().parent / "Graphs"


@dataclass(frozen=True)
class GraphData:
    name: str
    graph_number: int | None
    vertex_count: int
    edge_count: int
    edges: list[tuple[int, int, int]]

# On récupère la liste des graphs que l'on a trié avec notre super function de tri
def list_graphs() -> list[str]:
    return sorted((path.name for path in GRAPH_DIR.glob("*.txt")), key=natural_sort_key)


# On va lire le graph a partir du txt
def read_graph(filename: str) -> GraphData:
    path = GRAPH_DIR / filename
    if not path.exists():
        raise FileNotFoundError(f"Graph '{filename}' was not found.")

    with path.open("r", encoding="utf-8") as file:
        vertex_count = int(file.readline().strip())
        edge_count = int(file.readline().strip())
        edges: list[tuple[int, int, int]] = []

        # On va lire les edges une par une, on split la ligne pour récupérer le start, end et weight de chaque arête et on les converti en int avant de les ajouter à la liste des edges.
        for _ in range(edge_count):
            start, end, weight = map(int, file.readline().split())
            edges.append((start, end, weight))
    # Des que c'est fait on construit le GraphData pour l'ajouter au payload et l'envoyer au client
    return GraphData(
        name=filename,
        graph_number=extract_graph_number(filename),
        vertex_count=vertex_count,
        edge_count=edge_count,
        edges=edges,
    )


# Ici on contruit une matrice adjacente avec le nombre de sommet et les arêtes du graph, on initialise les distances à l'infini sauf pour les sommets eux même ou la distance est 0, et pour les arêtes ou la distance est le poids de l'arête.
def create_matrix(vertex_count: int, edges: list[tuple[int, int, int]]) -> list[list[float]]:
    # On met tout en infini
    matrix = [[INF] * vertex_count for _ in range(vertex_count)]

    # On met les diagonales à 0
    for vertex in range(vertex_count):
        matrix[vertex][vertex] = 0

    # On remplis la matrice avec le poids.
    for start, end, weight in edges:
        matrix[start][end] = min(matrix[start][end], weight)

    return matrix

# On prend en entré le nb de vertex et les edges pour fair l'algo
def floyd_warshall_with_steps(
    vertex_count: int, edges: list[tuple[int, int, int]]
) -> tuple[list[list[float]], list[list[int | None]], list[list[int | None]], list[dict[str, object]]]:
    distance = create_matrix(vertex_count, edges)
    # On met tout à None pour avoir nos matrice propres
    predecessor: list[list[int | None]] = [[None] * vertex_count for _ in range(vertex_count)]
    next_node: list[list[int | None]] = [[None] * vertex_count for _ in range(vertex_count)]

    # On initialise les matrices de prédecesseurs et de next_node en fonction des arêtes du graph, 
    # s'il y a une arête de start à end alors le prédecesseur de end est start et le next_node de start est end.
    for start, end, weight in edges:
        if weight <= distance[start][end]:
            predecessor[start][end] = start
        next_node[start][end] = end

    # Là on met les pred et next_node pour les sommets eux même, 
    # le prédecesseur d'un sommet lui même est lui même et le next_node d'un sommet lui même est lui même aussi.
    for vertex in range(vertex_count):
        next_node[vertex][vertex] = vertex

    steps: list[dict[str, object]] = []
    steps.append(
        {
            "k": None,
            "label": "Initial distances",
            "distanceMatrix": serialize_matrix(distance),
            "predecessorMatrix": serialize_predecessor_matrix(predecessor),
            "updates": [],
        }
    )


    # Pour tout sommet en intermédiaire
    for intermediate in range(vertex_count):
        updates: list[dict[str, object]] = []
        # Pour tout sommet de départ
        for start in range(vertex_count):
            if distance[start][intermediate] == INF:
                continue
            # Pour tout sommet d'arrivée
            for end in range(vertex_count):
                if distance[intermediate][end] == INF:
                    continue
                
                # Si distance pas infinie alors on calcule la distance candidate en passant par l'intermédiaire
                candidate = distance[start][intermediate] + distance[intermediate][end]
                if candidate < distance[start][end]:
                    # On met à jour la distance de départ à arrivée
                    distance[start][end] = candidate
                    # Le prédecesseur de arrivée devient le même que le prédecesseur de intermédiaire à arrivée
                    predecessor[start][end] = predecessor[intermediate][end]
                    # Le next_node de départ devient le même que le next_node de départ à intermédiaire
                    next_node[start][end] = next_node[start][intermediate]
                    updates.append(
                        {
                            "from": start,
                            "to": end,
                            "via": intermediate,
                            "new_distance": candidate,
                        }
                    )

        steps.append(
            {
                "k": intermediate,
                "label": f"Using vertex {intermediate} as an intermediate",
                "distanceMatrix": serialize_matrix(distance),
                "predecessorMatrix": serialize_predecessor_matrix(predecessor),
                "updates": updates,
            }
        )

    return distance, predecessor, next_node, steps

# Là on va reconstruire le chemin de départ à arrivée en utilisant la matrice next_node,
def reconstruct_path(
    next_node: list[list[int | None]], start: int, end: int
) -> list[int]:
    # Si le next_node de départ à arrivée est None alors no way donc on retourne une liste vide
    if next_node[start][end] is None:
        return []

    # SInon on commence avec le premier 
    path = [start]
    current = start
    # Tant que on n'est pas arrivé on recommence
    while current != end:
        # on met current au next_node de current à end
        current = next_node[current][end]
        if current is None:
            return []
        #s'il ya un next alors on l'ajoute
        path.append(current)
        # Là on voit si le circuit est absorbant
        # Si longeur chemin > long next + 1 alors c'est absorbant
        if len(path) > len(next_node) + 1:
            return []

    return path


# Là c'est pour remplacer les INF par "inf" sinon c'est moche
def serialize_matrix(matrix: list[list[float]]) -> list[list[float | str]]:
    serialized: list[list[float | str]] = []
    for row in matrix:
        serialized.append(["inf" if value == INF else value for value in row])
    return serialized

# Là c'est pour remplacer les None par "-" same
def serialize_predecessor_matrix(
    matrix: list[list[int | None]],
) -> list[list[int | str]]:
    serialized: list[list[int | str]] = []
    for row in matrix:
        serialized.append(["-" if value is None else value for value in row])
    return serialized


def has_absorbing_circuit(distance: list[list[float]]) -> bool:
    # pour chaque vertice on regarde si dist à lui est négative, si oui alors il y a un circuit absorbant
    return any(distance[index][index] < 0 for index in range(len(distance)))

# Là en gros on va construire le payload pour l'envoyer au client (interface) et ca comporte toutes les données du graphs
def graph_payload(filename: str) -> dict[str, object]:
    # On retrouve notre objet GraphData de tout à l'heure
    graph = read_graph(filename)
    distances, predecessors, next_node, steps = floyd_warshall_with_steps(graph.vertex_count, graph.edges)
    absorbing_circuit = has_absorbing_circuit(distances)

    # Là c'est les requetes du chemin
    path_queries: dict[str, dict[str, object]] = {}
    if not absorbing_circuit:
        # pour chaque sommet de départ et d'arrivée 
        for start in range(graph.vertex_count):
            for end in range(graph.vertex_count):
                if start == end:
                    continue
                # on reconstruit le chemin
                path = reconstruct_path(next_node, start, end)
                if not path:
                    continue
                # On l'ajoute à notre path
                path_queries[f"{start}-{end}"] = {
                    "path": path,
                    "distance": distances[start][end],
                }

    return {
        "name": graph.name,
        "graphNumber": graph.graph_number,
        "vertexCount": graph.vertex_count,
        "edgeCount": graph.edge_count,
        "nodes": [{"id": vertex, "label": str(vertex)} for vertex in range(graph.vertex_count)],
        "links": [
            {
                "source": start,
                "target": end,
                "weight": weight,
                "id": f"{start}-{end}",
            }
            for start, end, weight in graph.edges
        ],
        "floydWarshall": {
            "steps": steps,
            "shortestPaths": path_queries,
            "finalMatrix": serialize_matrix(distances),
            "finalPredecessorMatrix": serialize_predecessor_matrix(predecessors),
            "hasAbsorbingCircuit": absorbing_circuit,
        },
    }

# Ca va nous permettre de pouvoir trier les graphe par chiffre et pas par ordre alphabetique
def natural_sort_key(value: str) -> list[int | str]:
    parts = re.split(r"(\d+)", value)
    # Si c'est un int alors on le converti en int sinon on met en lower case les autres lettres (mais bon pas trop besoin)
    return [int(part) if part.isdigit() else part.lower() for part in parts]



def extract_graph_number(filename: str) -> int | None:
    # Va récupérer le premier chiffre présent dans le nom du fichier
    match = re.search(r"(\d+)", filename)
    # Une fois le chiffre trouvé on le converti en int et on le renvois, sinon on renvoie none. 
    return int(match.group(1)) if match else None
