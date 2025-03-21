"use client";

import {
  closestCorners,
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
} from "@dnd-kit/core";
import { Edit } from "lucide-react";
import React, { useCallback, useEffect, useState } from "react";

import { Breadcrumbs } from "@/components/breadcrumbs";
import ProjectEditDialog from "@/components/projects/project-edit-dialog";
import StateColumn from "@/components/projects/state-column";
import TaskBlock from "@/components/projects/task-block";
import TaskDetailSheet from "@/components/projects/task-detail-sheet";
import TaskEditorSheet, {
  TaskBoard,
} from "@/components/projects/task-editor-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { usePagePermission } from "@/hooks/use-page-permission";
import {
  findProjectById,
  findProjectWorkflowByTeam,
} from "@/lib/actions/project.action";
import {
  searchTeamRequests,
  updateTeamRequest,
  updateTeamRequestState,
} from "@/lib/actions/teams-request.action";
import { calculateDuration } from "@/lib/datetime";
import { obfuscate } from "@/lib/endecode";
import { useError } from "@/providers/error-provider";
import { useTeam } from "@/providers/team-provider";
import { useUserTeamRole } from "@/providers/user-team-role-provider";
import { ProjectDTO } from "@/types/projects";
import { Pagination, QueryDTO } from "@/types/query";
import { PermissionUtils } from "@/types/resources";
import { TeamRequestDTO } from "@/types/team-requests";
import { WorkflowDetailDTO, WorkflowStateDTO } from "@/types/workflows";

// Function to generate a constant background color for workflow states.
const getColumnColor = (_: number): string => "bg-[hsl(var(--card))]";

export const ProjectView = ({ projectId }: { projectId: number }) => {
  const team = useTeam();
  const permissionLevel = usePagePermission();
  const teamRole = useUserTeamRole().role;
  const [project, setProject] = useState<ProjectDTO | null>(null);
  const [workflow, setWorkflow] = useState<WorkflowDetailDTO | null>(null);
  const [tasks, setTasks] = useState<TaskBoard>({});
  const [loading, setLoading] = useState(true);
  const { setError } = useError();

  // State for drag and click management.
  const [activeTask, setActiveTask] = useState<TeamRequestDTO | null>(null);
  // State for tracking the selected task and its detail view.
  const [selectedTask, setSelectedTask] = useState<TeamRequestDTO | null>(null);
  const [isTaskDetailOpen, setIsTaskDetailOpen] = useState(false);
  // Track Add Task Sheet State.
  const [selectedWorkflowState, setSelectedWorkflowState] =
    useState<WorkflowStateDTO | null>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  // State for Project Edit Dialog visibility.
  const [isProjectEditDialogOpen, setIsProjectEditDialogOpen] = useState(false);
  // Track if dragging is in progress
  const [isDragging, setIsDragging] = useState(false);
  // Track the time when drag starts
  const [dragStartTime, setDragStartTime] = useState<number | null>(null);

  // Extracted fetchProjectData so we can use it on mount and after saving a project.
  const fetchProjectData = useCallback(async () => {
    setLoading(true);
    try {
      const projectData = await findProjectById(projectId, setError);
      setProject(projectData);

      // Fetch Workflow.
      const workflowData = await findProjectWorkflowByTeam(team.id!, setError);
      setWorkflow(workflowData);

      if (workflowData) {
        let allTasks: TeamRequestDTO[] = [];
        let currentPage = 1;
        const pageSize = 100;
        let totalElements = 0;

        do {
          const query: QueryDTO = {
            filters: [
              { field: "project.id", value: projectId, operator: "eq" },
            ],
          };
          const pagination: Pagination = {
            page: currentPage,
            size: pageSize,
            sort: [{ field: "id", direction: "desc" }],
          };

          const tasksData = await searchTeamRequests(
            query,
            pagination,
            setError,
          );
          allTasks = [...allTasks, ...tasksData.content];
          totalElements = tasksData.totalElements;
          currentPage++;
        } while (allTasks.length < totalElements);

        // Allocate tasks to columns based on workflow states.
        const newTasks: TaskBoard = {};
        workflowData.states.forEach((state) => {
          newTasks[state.id!.toString()] = allTasks.filter(
            (task) => task.currentStateId === state.id,
          );
        });

        setTasks(newTasks);
      }
    } finally {
      setLoading(false);
    }
  }, [projectId, team.id, setError]);

  useEffect(() => {
    fetchProjectData();
  }, [fetchProjectData]);

  // Handler for updating task details, including state changes
  const handleTaskUpdate = async (updatedTask: TeamRequestDTO) => {
    if (!updatedTask.id) return;

    try {
      // Check if state has changed
      const oldTask = Object.values(tasks)
        .flat()
        .find((t) => t.id === updatedTask.id);

      const stateChanged =
        oldTask && oldTask.currentStateId !== updatedTask.currentStateId;

      // If state has changed, we need to move the task between columns
      if (stateChanged) {
        setTasks((prevTasks) => {
          const newTasks = { ...prevTasks };

          // Remove the task from its current column
          const oldStateId = oldTask?.currentStateId?.toString();
          if (oldStateId && newTasks[oldStateId]) {
            newTasks[oldStateId] = newTasks[oldStateId].filter(
              (task) => task.id !== updatedTask.id,
            );
          }

          // Add the task to its new column
          const newStateId = updatedTask.currentStateId?.toString();
          if (newStateId) {
            if (!newTasks[newStateId]) {
              newTasks[newStateId] = [];
            }
            newTasks[newStateId] = [...newTasks[newStateId], updatedTask];
          }

          return newTasks;
        });
      } else {
        // If state hasn't changed, update the task in its current column
        setTasks((prevTasks) => {
          const newTasks = { ...prevTasks };

          // Find which column contains the task
          Object.keys(newTasks).forEach((columnId) => {
            const columnTasks = newTasks[columnId];
            const taskIndex = columnTasks.findIndex(
              (task) => task.id === updatedTask.id,
            );

            if (taskIndex !== -1) {
              // Update the task in the column
              newTasks[columnId] = [
                ...columnTasks.slice(0, taskIndex),
                updatedTask,
                ...columnTasks.slice(taskIndex + 1),
              ];
            }
          });

          return newTasks;
        });
      }

      // Also update the selected task if it's the one being edited
      if (selectedTask?.id === updatedTask.id) {
        setSelectedTask(updatedTask);
      }

      // Add current date as modifiedDate
      const taskWithModifiedDate = {
        ...updatedTask,
        modifiedAt: new Date(),
      };

      // Then call the API to update on the server
      await updateTeamRequest(
        taskWithModifiedDate.id!,
        taskWithModifiedDate,
        setError,
      );
    } catch (error) {
      console.error("Failed to update task:", error);
      // If something goes wrong, re-fetch all data to sync with server
      fetchProjectData();
    }
  };

  // Improved dragStart
  const handleDragStart = (event: DragStartEvent) => {
    const activeId = event.active.id.toString();

    // Set dragging state
    setIsDragging(true);
    // Record drag start time
    setDragStartTime(Date.now());

    // Find the task being dragged
    let foundTask: TeamRequestDTO | null = null;
    Object.keys(tasks).forEach((columnId) => {
      const task = tasks[columnId].find(
        (task) => task.id?.toString() === activeId,
      );
      if (task) {
        foundTask = task;
      }
    });

    if (foundTask) {
      setActiveTask(foundTask);
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    // Reset task state
    setActiveTask(null);

    // Calculate drag duration
    const dragDuration = dragStartTime ? Date.now() - dragStartTime : 0;

    // Reset drag tracking state
    setIsDragging(false);
    setDragStartTime(null);

    const { active, over } = event;
    if (!over) return;

    const activeId = active.id.toString();
    const overId = over.id.toString();

    // Check if dragging over a column or a task inside a column.
    const targetColumn = workflow?.states.find(
      (state) =>
        state.id!.toString() === overId ||
        tasks[state.id!.toString()]?.some(
          (task) => task.id!.toString() === overId,
        ),
    );

    if (!targetColumn) return;

    // Find source column.
    const sourceColumn = workflow?.states.find((state) =>
      tasks[state.id!.toString()]?.some(
        (task) => task.id!.toString() === activeId,
      ),
    );

    if (!sourceColumn || sourceColumn.id === targetColumn.id) {
      // If drag was very short and in the same column, treat as a click
      if (dragDuration < 200 && sourceColumn) {
        // Find the task
        const clickedTask = tasks[sourceColumn.id!.toString()]?.find(
          (task) => task.id!.toString() === activeId,
        );

        if (clickedTask) {
          // Handle as a click
          setSelectedTask(clickedTask);
          setIsTaskDetailOpen(true);
        }
      }
      return;
    }

    // Get moved task.
    const movedTask = tasks[sourceColumn.id!.toString()]?.find(
      (task) => task.id!.toString() === activeId,
    );

    if (!movedTask) return;

    // Update task state on the server
    await updateTeamRequestState(movedTask.id!, targetColumn.id!, setError);

    // Create updated task with new state information
    const updatedTask = {
      ...movedTask,
      currentStateId: targetColumn.id!,
      currentStateName: targetColumn.stateName,
      modifiedAt: new Date(),
    };

    // Update local state to move the task between columns
    setTasks((prevTasks) => {
      const updatedTasks = { ...prevTasks };

      // Remove task from source column
      updatedTasks[sourceColumn.id!.toString()] = updatedTasks[
        sourceColumn.id!.toString()
      ]?.filter((task) => task.id!.toString() !== activeId);

      // Add task to target column
      updatedTasks[targetColumn.id!.toString()] = [
        ...(updatedTasks[targetColumn.id!.toString()] || []),
        updatedTask,
      ];

      return updatedTasks;
    });
  };

  const breadcrumbItems = [
    { title: "Dashboard", link: "/portal" },
    { title: "Teams", link: "/portal/teams" },
    { title: team.name, link: `/portal/teams/${obfuscate(team.id)}` },
    { title: "Projects", link: `/portal/teams/${obfuscate(team.id)}/projects` },
    { title: project?.name!, link: "#" },
  ];

  return (
    <div className="p-6 h-screen flex flex-col">
      {loading ? (
        <p className="text-lg font-semibold">Loading project...</p>
      ) : project ? (
        <>
          <Breadcrumbs items={breadcrumbItems} />
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-3xl font-bold">{project.name}</h1>
            {(PermissionUtils.canWrite(permissionLevel) ||
              teamRole === "Manager") && (
              <Button
                onClick={() => setIsProjectEditDialogOpen(true)}
                variant="default"
                className="flex items-center gap-2"
              >
                <Edit className="w-4 h-4" />
                Edit project
              </Button>
            )}
          </div>

          <div
            className="text-gray-600 dark:text-gray-300 text-sm mb-4"
            dangerouslySetInnerHTML={{ __html: project.description ?? "" }}
          />

          <div className="flex flex-wrap items-center gap-4 mb-6">
            {project.status && (
              <div className="flex items-center">
                <span className="text-sm font-medium text-gray-500 dark:text-gray-400 mr-2">
                  Status:
                </span>
                <Badge variant="default">{project.status}</Badge>
              </div>
            )}

            {project.startDate && (
              <div className="flex items-center">
                <span className="text-sm font-medium text-gray-500 dark:text-gray-400 mr-2">
                  Start:
                </span>
                <span className="text-sm">
                  {new Date(project.startDate).toLocaleDateString()}
                </span>
              </div>
            )}

            {project.endDate && (
              <div className="flex items-center">
                <span className="text-sm font-medium text-gray-500 dark:text-gray-400 mr-2">
                  End:
                </span>
                <span className="text-sm">
                  {new Date(project.endDate).toLocaleDateString()}
                </span>
              </div>
            )}

            {project.startDate && project.endDate && (
              <div className="flex items-center">
                <span className="text-sm font-medium text-gray-500 dark:text-gray-400 mr-2">
                  Duration:
                </span>
                <span className="text-sm">
                  {calculateDuration(project.startDate, project.endDate)}
                </span>
              </div>
            )}
          </div>
        </>
      ) : (
        <p className="text-red-500">Project not found.</p>
      )}

      <DndContext
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        {/* Full height scrollable container with an extra div at the end */}
        <div
          className="flex flex-grow gap-4 pb-2"
          style={{
            overflowX: "scroll",
            scrollbarWidth: "thin", // For Firefox
            scrollbarGutter: "stable", // Reserves space for the scrollbar
            WebkitOverflowScrolling: "touch", // For iOS
            msOverflowStyle: "-ms-autohiding-scrollbar", // For IE/Edge
          }}
        >
          {workflow?.states
            .sort((a, b) => {
              if (a.isInitial && !b.isInitial) return -1;
              if (!a.isInitial && b.isInitial) return 1;
              if (a.isFinal && !b.isFinal) return 1;
              if (!a.isFinal && b.isFinal) return -1;
              return 0;
            })
            .map((state) => (
              <StateColumn
                key={state.id}
                workflowState={state}
                tasks={tasks[state.id!.toString()] || []}
                setIsSheetOpen={setIsSheetOpen}
                setSelectedWorkflowState={() => setSelectedWorkflowState(state)}
                columnColor={getColumnColor(state.id!)}
              />
            ))}
          {/* Add an extra padding div that matches column width */}
          <div className="min-w-[28rem] flex-shrink-0 opacity-0 pointer-events-none">
            {/* This invisible column ensures there's enough space at the end */}
          </div>
        </div>

        <DragOverlay>
          {activeTask ? <TaskBlock task={activeTask} isDragging /> : null}
        </DragOverlay>
      </DndContext>

      <TaskEditorSheet
        isOpen={isSheetOpen}
        setIsOpen={setIsSheetOpen}
        selectedWorkflowState={selectedWorkflowState}
        setTasks={setTasks}
        teamId={project?.teamId!}
        projectId={projectId}
        projectWorkflowId={workflow?.id!}
      />
      <TaskDetailSheet
        isOpen={isTaskDetailOpen}
        setIsOpen={setIsTaskDetailOpen}
        task={selectedTask}
        onTaskUpdate={handleTaskUpdate}
      />

      <ProjectEditDialog
        open={isProjectEditDialogOpen}
        setOpen={setIsProjectEditDialogOpen}
        teamEntity={team}
        project={project}
        onSaveSuccess={async () => {
          setIsProjectEditDialogOpen(false);
          await fetchProjectData();
        }}
      />
    </div>
  );
};

export default ProjectView;
