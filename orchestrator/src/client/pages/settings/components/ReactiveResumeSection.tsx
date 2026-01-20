import React, { useEffect, useState } from "react"
import { AlertCircle, CheckCircle2, RefreshCw } from "lucide-react"

import { AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import * as api from "../../../api"

type ReactiveResumeSectionProps = {
    rxResumeBaseResumeIdDraft: string | null
    setRxResumeBaseResumeIdDraft: (value: string | null) => void
    hasRxResumeApiKey: boolean
    isLoading: boolean
    isSaving: boolean
}

export const ReactiveResumeSection: React.FC<ReactiveResumeSectionProps> = ({
    rxResumeBaseResumeIdDraft,
    setRxResumeBaseResumeIdDraft,
    hasRxResumeApiKey,
    isLoading,
    isSaving,
}) => {
    const [resumes, setResumes] = useState<{ id: string; name: string }[]>([])
    const [isFetchingResumes, setIsFetchingResumes] = useState(false)
    const [fetchError, setFetchError] = useState<string | null>(null)

    const fetchResumes = async () => {
        if (!hasRxResumeApiKey) return

        setIsFetchingResumes(true)
        setFetchError(null)
        try {
            const data = await api.getRxResumes()
            setResumes(data)
        } catch (error) {
            setFetchError(error instanceof Error ? error.message : "Failed to fetch resumes")
        } finally {
            setIsFetchingResumes(false)
        }
    }

    useEffect(() => {
        if (hasRxResumeApiKey) {
            fetchResumes()
        }
    }, [hasRxResumeApiKey])

    return (
        <AccordionItem value="reactive-resume" className="border rounded-lg px-4">
            <AccordionTrigger className="hover:no-underline py-4">
                <span className="text-base font-semibold">Reactive Resume</span>
            </AccordionTrigger>
            <AccordionContent className="pb-4">
                <div className="space-y-4">
                    {!hasRxResumeApiKey ? (
                        <Alert variant="destructive">
                            <AlertCircle className="h-4 w-4" />
                            <AlertTitle>API Key Missing</AlertTitle>
                            <AlertDescription>
                                <code>RXRESUME_API_KEY</code> is not configured in the server environment. Please add it to your <code>.env</code> file.
                            </AlertDescription>
                        </Alert>
                    ) : (
                        <>
                            <Alert className="bg-green-50 border-green-200 dark:bg-green-900/10 dark:border-green-900/20">
                                <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                                <AlertTitle className="text-green-800 dark:text-green-300">API Key Configured</AlertTitle>
                                <AlertDescription className="text-green-700 dark:text-green-400">
                                    Reactive Resume API integration is active.
                                </AlertDescription>
                            </Alert>

                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <div className="text-sm font-medium">Base Resume</div>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={fetchResumes}
                                        disabled={isFetchingResumes || isLoading || isSaving}
                                        className="h-8 px-2"
                                    >
                                        <RefreshCw className={`h-3 w-3 mr-1 ${isFetchingResumes ? 'animate-spin' : ''}`} />
                                        Refresh
                                    </Button>
                                </div>

                                <Select
                                    value={rxResumeBaseResumeIdDraft || "none"}
                                    onValueChange={(value: string) => setRxResumeBaseResumeIdDraft(value === "none" ? null : value)}
                                    disabled={isLoading || isSaving || isFetchingResumes}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select a base resume..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="none">None (Fallback to local base.json)</SelectItem>
                                        {resumes.map((resume) => (
                                            <SelectItem key={resume.id} value={resume.id}>
                                                {resume.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>

                                {fetchError && (
                                    <div className="text-xs text-destructive mt-1">
                                        {fetchError}
                                    </div>
                                )}

                                <div className="text-xs text-muted-foreground mt-2">
                                    The selected resume will be used as a template for tailoring. A temporary copy will be created during generation and deleted afterwards.
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </AccordionContent>
        </AccordionItem>
    )
}
