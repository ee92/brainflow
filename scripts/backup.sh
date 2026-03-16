#!/bin/bash
# Run from project root
BACKUP_DIR="./backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
mkdir -p "$BACKUP_DIR"
docker-compose exec -T postgres pg_dump -U draw draw > "$BACKUP_DIR/draw_$TIMESTAMP.sql"
# Keep last 30 backups
ls -t "$BACKUP_DIR"/draw_*.sql | tail -n +31 | xargs rm -f 2>/dev/null
echo "Backup: $BACKUP_DIR/draw_$TIMESTAMP.sql"
