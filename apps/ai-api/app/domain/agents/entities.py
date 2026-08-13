from dataclasses import dataclass
from typing import Literal

Severity = Literal["fail", "warning", "pass"]


@dataclass(frozen=True)
class Finding:
    status: Severity
    title: str
    detail: str
    business_rule: str | None = None
    convention_ref: str | None = None

    def to_payload(self) -> dict:
        payload: dict = {
            "status": self.status,
            "title": self.title,
            "detail": self.detail,
        }
        if self.business_rule:
            payload["businessRule"] = self.business_rule
        if self.convention_ref:
            payload["conventionRef"] = self.convention_ref
        return payload
