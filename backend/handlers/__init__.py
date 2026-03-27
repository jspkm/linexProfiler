"""Handler modules for shared endpoint logic.

Each handler returns a plain (dict, int) tuple -- the caller (main.py or
dev_server.py) is responsible for converting that into the appropriate
framework response (Firebase Response or Flask jsonify).
"""
