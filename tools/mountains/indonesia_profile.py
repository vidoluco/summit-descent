"""Hillshade map and altitude profile of the Indonesia (Mount Kerinci) world, for docs/mountains/indonesia.md.

Usage: python3 tools/mountains/indonesia_profile.py [out.png]
Reads data/worlds/indonesia/world.json and the whole descent line from tools/mountains/line.mjs (node,
offline). Top: hillshade of the DEM around the route, the line read by the bake, the played stages, the
OSM villages and the posts of the Kersik Tuo trail (to show where the water runs next to the climbers'
route). Bottom: real bed altitude along the line, the stages, the cloud jumps, the valley floor, and the
published altitudes of the trail posts. Needs matplotlib and numpy (nothing is installed here).
"""
import json
import subprocess
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
WID = "indonesia"
COLORS = ["#2f6fdf", "#16a3a0", "#e0962a", "#c8443c"]
# trail posts: OSM position, altitude from gunungbagging.com (other guides differ by up to 50 m; docs/mountains/indonesia.md)
TRAIL = [
    ("Shelter 3", -1.70575, 101.26718, 3306),
    ("Shelter 2", -1.70983, 101.26798, 3045),
    ("Shelter 1", -1.72033, 101.26360, 2520),
    ("Kerinci trek start", -1.74700, 101.25936, None),
]
# where the boundary of Taman Nasional Kerinci Seblat (OSM relation 8465254) crosses the line (reviewed 27/10/2026)
PARK_EDGE = (-1.72684, 101.29610, 1804)
PUBLISHED = [("Tugu Yudha", 3690), ("Shelter 3", 3306), ("Shelter 2", 3045), ("Shelter 1", 2520), ("Pos 3", 2211), ("Pos 1", 1915), ("tiger statue, end of the road", 1755), ("Kersik Tuo", 1519)]


def hillshade(z, step, az=315.0, alt=40.0):
    gy, gx = np.gradient(z, step)  # rows go south (+z), columns east (+x)
    slope = np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gy, gx)
    a, h = np.radians(360.0 - az + 90.0), np.radians(alt)
    return np.clip(np.sin(h) * np.cos(slope) + np.cos(h) * np.sin(slope) * np.cos(a - aspect), 0, 1)


def main():
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "docs" / "mountains" / f"{WID}-profile.png"
    world = json.loads((ROOT / "data" / "worlds" / WID / "world.json").read_text())
    line = json.loads(subprocess.run(["node", "tools/mountains/line.mjs", WID], cwd=ROOT, check=True, capture_output=True, text=True).stdout)
    g = line["grid"]
    Z = np.array(g["data"], dtype=float).reshape(g["h"], g["w"])
    pts = line["line"]
    rk = np.array([p["rk"] for p in pts]) / 1000.0
    alt = np.array([p["alt"] for p in pts])
    lx, lz = np.array([p["x"] for p in pts]), np.array([p["z"] for p in pts])
    floor_km = line["floor"]["rk"] / 1000.0
    p0 = np.radians(world["frame"]["lat"])
    mlat = 111132.954 - 559.822 * np.cos(2 * p0) + 1.175 * np.cos(4 * p0)
    mlon = 111412.84 * np.cos(p0) - 93.5 * np.cos(3 * p0)
    to_km = lambda lat, lon: ((lon - world["frame"]["lon"]) * mlon / 1000, (lat - world["frame"]["lat"]) * mlat / 1000)  # noqa: E731

    fig = plt.figure(figsize=(11, 11), dpi=110)
    ax = fig.add_axes([0.07, 0.42, 0.88, 0.54])
    ext = [g["x0"] / 1000, (g["x0"] + (g["w"] - 1) * g["step"]) / 1000, -(g["z0"] + (g["h"] - 1) * g["step"]) / 1000, -g["z0"] / 1000]
    ax.imshow(Z, extent=ext, cmap="terrain", vmin=Z.min() - 800, vmax=Z.max() + 200, interpolation="bilinear")
    ax.imshow(hillshade(Z, g["step"]), extent=ext, cmap="gray", alpha=0.55, interpolation="bilinear")
    cs = ax.contour(np.linspace(ext[0], ext[1], g["w"]), np.linspace(ext[3], ext[2], g["h"]), Z, levels=np.arange(1500, 3900, 250), colors="k", linewidths=0.35, alpha=0.45)
    ax.clabel(cs, fmt="%d", fontsize=6, inline=True)
    ax.plot(lx / 1000, -lz / 1000, color="#333", lw=1.2, ls="--", alpha=0.8, label="line read by the bake (Sungai Kering, Batang Sangir)")
    for k, s in enumerate(world["stages"]):
        cx = np.array([p["x"] for p in s["course"]]) + s["offset"]["x"]
        cz = np.array([p["z"] for p in s["course"]]) + s["offset"]["z"]
        ax.plot(cx / 1000, -cz / 1000, color=COLORS[k], lw=3.4, label=f"stage {k + 1}: {s['labels']['en']} ({s['altitude'][1]}-{s['altitude'][0]} m)")
        ax.plot(cx[-1] / 1000, -cz[-1] / 1000, "o", color=COLORS[k], ms=5, mec="white")
    ex, ey = to_km(PARK_EDGE[0], PARK_EDGE[1])
    ax.plot(ex, ey, "X", color="#1d6b2a", ms=8, mec="white", label=f"Kerinci Seblat national park edge on the line ({PARK_EDGE[2]} m)")
    ax.plot(0, 0, "^", color="k", ms=10, mec="white")
    ax.annotate(f"Gunung Kerinci 3805 m (DEM {line['summit']['h']:.0f} m)", (0, 0), xytext=(8, 2), textcoords="offset points", fontsize=8, weight="bold")
    for name, lat, lon, a in TRAIL:
        x, y = to_km(lat, lon)
        ax.plot(x, y, "D", color="#6b2fa0", ms=4, mec="white")
        ax.annotate(f"{name}{f' {a} m' if a else ''}", (x, y), xytext=(6, -3), textcoords="offset points", fontsize=7, color="#6b2fa0", bbox=dict(boxstyle="round,pad=0.15", fc="white", ec="none", alpha=0.75))
    for p in world["places"][1:]:
        x, y = to_km(p["lat"], p["lon"])
        if ext[0] < x < ext[1] and ext[2] < y < ext[3]:
            ax.plot(x, y, "s", color="k", ms=3.5)
            ax.annotate(p["name"], (x, y), xytext=(4, 3), textcoords="offset points", fontsize=7)
    ax.set_xlim(ext[0], min(ext[1], 9))
    ax.set_ylim(max(ext[2], -9.5), ext[3])
    ax.set_aspect("equal")
    ax.set_xlabel("km east of the summit")
    ax.set_ylabel("km north of the summit")
    ax.set_title("Indonesia, Mount Kerinci: course at 1:1 on Copernicus GLO-30 (hillshade, 250 m contours); purple: trail posts", fontsize=9.5)
    ax.legend(loc="lower left", fontsize=7, framealpha=0.85)

    bx = fig.add_axes([0.07, 0.06, 0.88, 0.29])
    bx.fill_between(rk, alt, alt.min() - 100, color="#d9d4c7")
    bx.plot(rk, alt, color="#555", lw=1)
    for k, s in enumerate(world["stages"]):
        m = (rk >= s["realKm"][0]) & (rk <= s["realKm"][1])
        slope = (s["altitude"][1] - s["altitude"][0]) / s["length"] * 100
        bx.plot(rk[m], alt[m], color=COLORS[k], lw=4)
        bx.annotate(f"{k + 1}  {s['labels']['en']}\n{s['length']} m, {s['altitude'][1]}-{s['altitude'][0]} m, {slope:.0f} %", (np.mean(s["realKm"]), s["altitude"][1]), xytext=(6, 4), textcoords="offset points", fontsize=7, color=COLORS[k], weight="bold")
        if k:
            a = world["stages"][k - 1]
            bx.annotate("", (s["realKm"][0], s["altitude"][1]), xytext=(a["realKm"][1], a["altitude"][0]), arrowprops=dict(arrowstyle="->", ls=":", color="#3a7bd5", lw=1))
    edge_km = rk[np.argmin(np.hypot(lx / 1000 - ex, -lz / 1000 - ey))]
    bx.axvline(edge_km, color="#1d6b2a", ls="-.", lw=0.9)
    bx.annotate(f"national park edge\n{PARK_EDGE[2]} m", (edge_km, alt.min()), xytext=(4, 30), textcoords="offset points", fontsize=7, color="#1d6b2a")
    bx.axvline(floor_km, color="k", ls="--", lw=0.8)
    bx.annotate(f"valley floor {line['floor']['alt']:.0f} m\n(mean slope < {world['floor']['slope'] * 100:.1f} % over {world['floor']['window'] / 1000:.0f} km)", (floor_km, alt.min()), xytext=(6, 4), textcoords="offset points", fontsize=7)
    for i, (name, a) in enumerate(PUBLISHED):
        bx.axhline(a, color="#6b2fa0", lw=0.5, ls=":", alpha=0.7)
        bx.annotate(f"{name} {a} m", (rk.max(), a), xytext=(-4, 2), textcoords="offset points", fontsize=6.5, color="#6b2fa0", ha="right")
    bx.set_xlim(rk.min(), rk.max())
    bx.set_ylim(alt.min() - 100, alt.max() + 200)
    bx.set_xlabel("km along the line (0 = OSM stream node under the crater rim, negative = summit path)")
    bx.set_ylabel("real bed altitude (m)")
    bx.set_title("Profile: played stages in colour, dotted arrows are the cloud jumps; purple: published altitudes of the trail posts", fontsize=9.5)
    bx.grid(alpha=0.3)
    fig.text(0.07, 0.01, "Data: Copernicus DEM GLO-30 (c) DLR e.V. 2010-2014 and Airbus 2014-2018, provided under COPERNICUS by the EU and ESA; waterways, places, shelters (c) OpenStreetMap contributors, ODbL", fontsize=6.5, color="#555")
    out.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out)
    print(out)


if __name__ == "__main__":
    main()
