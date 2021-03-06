-module(local_rooms_state).

-behavior(gen_server).

%% External exports
-export([
  start_link/0, get_room_pid/1, get_rooms_list/0, add_room/2, broadcast_slaves/2, broadcast_slaves/1,
  get_servers_list/0, is_master/0, find_room_pid/1, remove_slave/1,
  broadcast_players/2, clean_state/0
]).

%% Internal exports
-export([init/1, handle_call/3, handle_cast/2, handle_info/2, terminate/2, code_change/3]).

% #state.rooms saved as: {room_id, room_pid}
% #state.slaves saved ad: {slave_name, slave_pid, slave_service_url}
-record(state, {rooms = [], slaves = [], role}).

%%% ---------------------------------------------------
%%%
%%% gen_server.
%%%
%%% ---------------------------------------------------

start_link() ->
  gen_server:start_link({local, ?MODULE}, ?MODULE, [], []).

init(_Args) ->
  Role = utils:get_initial_role(),
  case Role of
    master ->
      monitor_mesh:start_monitor_mesh();
    slave ->
      slave_handler:connect_to_master(utils:get_master_name())
  end,
  {ok, #state{role = Role}}.

% Synchronous messages
handle_call(_Request, _From, State) ->
  case _Request of
    clean_state ->
      utils:log("Cleaning current state.~n", []),
      lists:flatmap(
        fun({_, Room_pid}) ->
          room:stop(Room_pid),
          []
        end,
        State#state.rooms
      ),
      New_state = State#state{rooms = [], slaves = []},
      utils:log("Finished cleaning current state.~n", []),
      {reply, ok, New_state};
    {find_room_pid, Room_id} ->
      {reply, find_room_pid(Room_id, State#state.rooms), State};
    is_master ->
      case State#state.role of
        master ->
          {reply, true, State};
        _ ->
          {reply, false, State}
      end;
    {room_add, {Room_id, Room_pid}} ->
      New_state = State#state{rooms = [{Room_id, Room_pid} | State#state.rooms]},
      utils:log("Rooms: ~p~n", [New_state#state.rooms]),
      {reply, ok, New_state};
    get_rooms_list ->
      Rooms_list = lists:flatmap(fun(Room) -> {Id, _} = Room, [Id] end, State#state.rooms),
      utils:log("Rooms list: ~p~n", [Rooms_list]),
      {reply, Rooms_list, State};
    {get_room_pid, Room_id} ->
      utils:log("Searching room_pid of room id:~n~p~n", [Room_id]),
      Room_pid = find_room_pid(Room_id, State#state.rooms),
      {reply, Room_pid, State};
    servers_list ->
      Server_list = create_servers_list(State),
      {reply, Server_list, State};
    Unknown ->
      utils:log("Warning: unknown message received in 'local_room_state:handle_call', message: ~p~n", [Unknown]),
      {reply, ok, State}
  end.

% Asynchronous messages, Slaves broadcast
handle_cast({Event, Data}, State) ->
  utils:log("Broadcast to Slaves: ~p~n", [State#state.slaves]),
  broadcast_slaves(State#state.slaves, {Event, Data}),
  {noreply, State};
handle_cast(Request, State) ->
  utils:log("Warning: unknown message received in 'local_room_state:handle_cast', message: ~p~n", [Request]),
  {noreply, State}.

% Asynchronous messages
handle_info(Data, State) ->
  case Data of
    {slave_remove, Slave_name} ->
      New_state = State#state{slaves = remove_slave(State#state.slaves, Slave_name)},
      utils:log("Removed slave of name: ~p~n", [Slave_name]),
      broadcast_players(
        New_state#state.rooms,
        {broadcast_players, {servers_list, create_servers_list(New_state)}}
      ),
      {noreply, New_state};
    master_takeover ->
      utils:log("Slave becoming the new master, node name: ~p~n", [node()]),
      Slaves = lists:flatmap(
        fun(Node) ->
          [{
            Node,
            rpc:call(Node, slave_handler, get_pid, [], 2000),
            rpc:call(Node, utils, get_service_url, [], 2000)
          }]
        end,
        nodes()
      ),
      New_state = State#state{role = master, slaves = lists:reverse(lists:keysort(1, Slaves))},
      % Creating local master snapshot
      utils:log("Starting creating local master snapshot...~n", []),
      Snapshot = lists:flatmap(fun({_, Room_pid}) -> [room:create_state_snapshot(Room_pid)] end, New_state#state.rooms),
      utils:log("Master local state snapshot: ~n~p~n", [Snapshot]),
      lists:flatmap(
        fun({Slave_name, Slave_pid, _}) ->
          % Send state snapshot to slave
          utils:log("Master sends local state snapshot to slave name: ~p and pid: ~p~n", [Slave_name, Slave_pid]),
          Slave_pid ! {set_state, Snapshot},
          []
        end,
        New_state#state.slaves
      ),
      {noreply, New_state};
    {room_remove, Room_id} ->
      New_state = State#state{rooms = remove_room(State#state.rooms, Room_id)},
      {noreply, New_state};
    {slave_connect, Slave_name, Service_url} ->
      utils:log("Master connects to slave: ~p~n", [Slave_name]),
      case rpc:call(Slave_name, slave_handler, slave_handler_sup, [{node(), utils:get_service_url()}], 2000) of
        Slave_pid ->
          % Add slave to state
          New_state = State#state{
            slaves = lists:reverse(
              lists:keysort(1, [{Slave_name, Slave_pid, Service_url} | State#state.slaves])
            )
          },
          % Creating local master snapshot
          utils:log("Starting creating local master snapshot...~n", []),
          Snapshot = lists:flatmap(fun({_, Room_pid}) -> [room:create_state_snapshot(Room_pid)] end, State#state.rooms),
          utils:log("Master local state snapshot: ~n~p~n", [Snapshot]),
          % Send state snapshot to slave
          utils:log("Master sends local state snapshot to slave: ~p~n", [Slave_name]),
          Slave_pid ! {set_state, Snapshot},
          broadcast_players(
            New_state#state.rooms,
            {broadcast_players, {servers_list, create_servers_list(New_state)}}
          )
      end,
      {noreply, New_state};
    Unknown ->
      utils:log("Warning: unknown message received in 'local_room_state:handle_info', message: ~p~n", [Unknown]),
      {noreply, State}
  end.

terminate(Reason, _State) ->
  utils:log("Terminating 'local_room_state', reason: ~p~n", [Reason]),
  ok.

code_change(_OldVsn, State, _Extra) ->
  {ok, State}.

%%% ---------------------------------------------------
%%%
%%% gen_server calls: utilities functions.
%%%
%%% ---------------------------------------------------

clean_state() ->
  gen_server:call(whereis(local_rooms_state), clean_state).

add_room(Room_id, Room_pid) ->
  gen_server:call(whereis(local_rooms_state), {room_add, {Room_id, Room_pid}}).

get_room_pid(Room_id) ->
  gen_server:call(whereis(local_rooms_state), {get_room_pid, Room_id}).

get_rooms_list() ->
  gen_server:call(whereis(local_rooms_state), get_rooms_list).

find_room_pid(Room_id) ->
  gen_server:call(whereis(local_rooms_state), {find_room_pid, Room_id}).

broadcast_slaves(Data) ->
  gen_server:cast(whereis(local_rooms_state), Data).

broadcast_slaves([{_, Slave_pid, _} | Slaves], Data) ->
  gen_server:cast(Slave_pid, Data),
  broadcast_slaves(Slaves, Data);
broadcast_slaves([], _) ->
  ok.

get_servers_list() ->
  gen_server:call(whereis(local_rooms_state), servers_list).

is_master() ->
  gen_server:call(whereis(local_rooms_state), is_master).

remove_slave(Slave_name) ->
  whereis(local_rooms_state) ! {slave_remove, Slave_name}.

%%% ---------------------------------------------------
%%%
%%% Utilities functions.
%%%
%%% ---------------------------------------------------

find_room_pid(Room_id, [{Room_id, Room_pid} | _]) -> Room_pid;
find_room_pid(Room_id, [_ | XS]) -> find_room_pid(Room_id, XS);
find_room_pid(Room_id, []) ->
  utils:log("Warning: there is no such a room of id: ~p~n", [Room_id]),
  error.

remove_slave([{Slave_name, _, _} | XS], Slave_name) ->
  XS;
remove_slave([X | XS], Slave_name) ->
  lists:append([X], remove_slave(XS, Slave_name));
remove_slave([], Slave_name) ->
  utils:log("Warning: there is no such a 'slave' to be removed with name: ~p~n", [Slave_name]),
  error.

remove_room([{Room_id, Room_pid} | XS], Room_id) ->
  Room_pid ! stop,
  XS;
remove_room([X | XS], Room_id) -> lists:append([X], remove_room(XS, Room_id));
remove_room([], Room_id) ->
  utils:log("Warning: there is no such a 'room' with id: ~p~n", [Room_id]),
  error.

broadcast_players(Rooms, Msg) ->
  lists:flatmap(fun({_, Room_pid}) -> Room_pid ! Msg, [] end, Rooms).

create_servers_list(State) ->
  case State#state.role of
    master ->
      Is_master = true;
    _ ->
      Is_master = false
  end,
  case Is_master of
    true ->
      Master_service = utils:get_service_url(),
      Server_list = lists:append([
        [Master_service],
        lists:flatmap(
          fun({_, _, Service_url}) ->
            [Service_url]
          end,
          lists:reverse(
            lists:keysort(1, State#state.slaves)
          )
        )
      ]);
    false ->
      {_, Service_url} = slave_handler:get_master_data(),
      Server_list = [Service_url, utils:get_service_url()]
  end,
  Server_list.
