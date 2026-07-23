"""Sonde : expansion complète du message ZH d'une fixture PAM via eccodes.

Usage : venv/bin/python3 tools/probe_pam_layout.py <fixture.bufr>
Imprime chaque descripteur expansé avec width/scale/reference (tables
eccodes-definitions), pour transcrire la marche bit à bit.
"""
from __future__ import annotations

import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import eccodes  # noqa: E402

from pam_bitstream import select_zh_message, split_messages  # noqa: E402


def main() -> None:
    zh = select_zh_message(split_messages(Path(sys.argv[1]).read_bytes()))
    tmp = Path("/tmp/probe-zh.bufr")
    tmp.write_bytes(zh.raw)
    with tmp.open("rb") as stream:
        handle = eccodes.codes_bufr_new_from_file(stream)
        eccodes.codes_set(handle, "unpack", 1)
        expanded = eccodes.codes_get_array(handle, "expandedDescriptors")
        names = eccodes.codes_get_array(handle, "expandedNames")
        counts = Counter(int(d) for d in expanded)
        print(f"{len(expanded)} éléments expansés")
        previous = None
        run = 0
        for descriptor, name in zip(expanded, names):
            key = (int(descriptor), str(name))
            if key == previous:
                run += 1
                continue
            if previous is not None:
                print(f"{previous[0]:06d} ×{run:<7d} {previous[1]}")
            previous, run = key, 1
        if previous is not None:
            print(f"{previous[0]:06d} ×{run:<7d} {previous[1]}")
        print("top réplications :", counts.most_common(5))
        eccodes.codes_release(handle)


if __name__ == "__main__":
    main()
