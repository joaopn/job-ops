import { MoveDiagonal2, RefreshCw } from "lucide-react";
import { TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";
import { Button } from "@/components/ui/button";

export function DesignResumeArtboard() {
  return (
    <section className="relative flex min-h-0 flex-col overflow-hidden rounded-2xl">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <TransformWrapper
          initialScale={0.9}
          minScale={0.6}
          maxScale={1.8}
          centerOnInit
        >
          {({ zoomIn, zoomOut, resetTransform }) => (
            <>
              <div className="absolute right-4 top-4 z-10 flex flex-col gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="bg-background/90"
                  onClick={() => zoomIn()}
                >
                  +
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="bg-background/90"
                  onClick={() => zoomOut()}
                >
                  -
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="bg-background/90"
                  onClick={() => resetTransform()}
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>

              <TransformComponent
                wrapperClass="!h-full !w-full !min-h-0"
                contentClass="!w-full !h-full"
              >
                <div className="flex h-full min-h-0 items-center justify-center bg-muted/10 px-6 py-12">
                  <div className="relative h-[980px] w-[720px] rounded-[1.75rem] border border-border/70 bg-card shadow-[0_24px_80px_rgba(0,0,0,0.24)]">
                    <div className="absolute inset-5 grid place-items-center rounded-[1.25rem] border border-dashed border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0.01))] text-center">
                      <div className="max-w-md space-y-4 px-10">
                        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-border/70 bg-background/80 text-muted-foreground">
                          <MoveDiagonal2 className="h-6 w-6" />
                        </div>
                        <div className="text-3xl font-semibold tracking-tight text-foreground">
                          Preview coming soon
                        </div>
                        <p className="text-sm leading-7 text-muted-foreground">
                          This area is ready for zooming and panning once the
                          live preview is added.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </TransformComponent>
            </>
          )}
        </TransformWrapper>
      </div>
    </section>
  );
}
