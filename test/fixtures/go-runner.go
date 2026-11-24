package main

import (
	"encoding/json"
	"math"
	"os"
)

// Minimal runner used by the TypeScript test suite. The generated validator is
// compiled into this package with `packageName: "main"`, then fed a JSON array
// of values on stdin. Output is a JSON array of error lists.
//
// Wire sentinels match the Python runner so undefined / NaN / ±Infinity survive
// JSON transport with the same meaning on every side.
func _decodeWire(v any) any {
	switch x := v.(type) {
	case map[string]any:
		if b, ok := x["$missing"].(bool); ok && b {
			return Missing
		}
		if b, ok := x["$nan"].(bool); ok && b {
			return math.NaN()
		}
		if raw, ok := x["$inf"]; ok {
			if n, ok := raw.(float64); ok && n > 0 {
				return math.Inf(1)
			}
			return math.Inf(-1)
		}
		out := make(map[string]any, len(x))
		for key, value := range x {
			out[key] = _decodeWire(value)
		}
		return out
	case []any:
		out := make([]any, len(x))
		for i, value := range x {
			out[i] = _decodeWire(value)
		}
		return out
	default:
		return v
	}
}

func main() {
	var input []map[string]any
	if err := json.NewDecoder(os.Stdin).Decode(&input); err != nil {
		panic(err)
	}
	out := make([]any, 0, len(input))
	for _, item := range input {
		out = append(out, Validate(_decodeWire(item["value"])))
	}
	if err := json.NewEncoder(os.Stdout).Encode(out); err != nil {
		panic(err)
	}
}
