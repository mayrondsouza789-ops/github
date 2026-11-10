"""Load the released snapshot and score using the matching immutable run."""
import hashlib
import json
import pickle
from functools import lru_cache
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'dist' / 'data.json'
RUNS = ROOT / 'backend' / 'runs'
LEGACY_VERSION = 'rr2-20261101T165216Z'


class InvalidFeatures(ValueError):
    """The submitted features cannot be scored by the requested model."""


class UnavailableRelease(RuntimeError):
    """The published report and its artifact or database are inconsistent."""


@lru_cache(maxsize=1)
def _read_snapshot(file_identity):
    return json.loads(DATA.read_bytes())


def published_snapshot():
    # Promotion atomically replaces data.json. A running API picks up that release.
    stat = DATA.stat()
    return _read_snapshot((stat.st_ino, stat.st_mtime_ns, stat.st_size))


@lru_cache(maxsize=3)
def _artifact(version, expected_digest):
    if Path(version).name != version or not version.startswith(('rr2-', 'rr3-')):
        raise UnavailableRelease('The published model version is invalid.')
    try:
        # Only trusted, local registry artifacts are eligible.
        blob = (RUNS / version / 'model.pkl').read_bytes()
        if expected_digest and hashlib.sha256(blob).hexdigest() != expected_digest:
            raise UnavailableRelease('The model artifact failed its published checksum.')
        result = pickle.loads(blob)
    except (OSError, ImportError, ValueError, pickle.UnpicklingError, EOFError) as error:
        raise UnavailableRelease('The published model artifact could not be loaded.') from error
    if result.get('version') != version:
        raise UnavailableRelease('The model artifact version differs from its registry entry.')
    return result


def score_request(report, values=None, features=None, model_version=None):
    if (values is None) == (features is None):
        raise InvalidFeatures('Supply either a named features object or an ordered values array.')
    version = model_version or report['version']
    # Historical clients submitted 14 unnamed v2 inputs. Keep their exact model contract.
    if values is not None and model_version is None:
        if len(values) != 14:
            raise InvalidFeatures('Supply model_version for an ordered vector, or use named features.')
        version = LEGACY_VERSION
    if version not in (LEGACY_VERSION, report['version']):
        raise InvalidFeatures('Use the current model_version from /api/model or the supported legacy version.')
    current = version == report['version']
    digest = report.get('artifact_sha256') if current else None
    if current and report.get('schema_version') == 3 and not digest:
        raise UnavailableRelease('The model report is missing its artifact checksum.')
    artifact = _artifact(version, digest)
    names = artifact['features']
    if current and (names != report['features'] or artifact.get('horizon') != report['horizon'] or
                    artifact.get('schema_version') != report.get('schema_version') or
                    (report.get('schema_version') == 3 and artifact.get('grace') != report['grace'])):
        raise UnavailableRelease('The artifact feature schema, horizon or grace differs from the published report.')
    if features is not None:
        if set(features) != set(names):
            missing = sorted(set(names) - set(features))
            extra = sorted(set(features) - set(names))
            raise InvalidFeatures(f'Feature names differ. Missing {missing}, unexpected {extra}.')
        values = [features[name] for name in names]
    if len(values) != len(names):
        raise InvalidFeatures(f'Expected {len(names)} values in the published feature order.')

    nullable = {'average_interval', 'interval_variability'}
    if artifact.get('schema_version') == 3:
        from .prediction import NULLABLE_FEATURES, predict_probabilities
        nullable = set(NULLABLE_FEATURES)
    for name, value in zip(names, values):
        if value is None and name in nullable:
            continue
        if value is None or not np.isfinite(value):
            raise InvalidFeatures(f'{name} requires a finite numerical value.')
    matrix = np.array([values], dtype=float)
    try:
        if artifact.get('schema_version') == 3:
            probability = float(predict_probabilities(artifact, matrix)[0])
        else:
            raw = artifact['model'].predict_proba(matrix)[:, 1, None]
            probability = float(artifact['calibrator'].predict_proba(raw)[0, 1])
    except ValueError as error:
        raise InvalidFeatures(str(error)) from error
    if not np.isfinite(probability) or not 0 <= probability <= 1:
        raise UnavailableRelease('The released model returned an invalid probability.')
    return {'synthetic': True, 'probability': probability, 'horizon': artifact['horizon'],
            'model_version': version, 'feature_order': names}
